/**
 * `sessionStorage`-backed `StoragePort`.
 *
 * This module mirrors `local-storage.ts` over the tab-scoped backend: the
 * same string-only CRUD mapped to `StorageResult` (never throwing) and the
 * same external-only observation. Because `sessionStorage` is isolated per
 * tab, cross-tab storage events never arrive here; same-tab sibling sessions
 * still synchronize through the `BroadcastChannel` leg of the sync transport,
 * which is why the channel wiring is identical. Nothing touches `window` at
 * import time; the backend resolves lazily on every operation.
 */
import { EMPTY, Subject } from 'rxjs'
import type { Observable } from 'rxjs'
import type { StorageError, StoragePort, StorageResult } from '../../domain/ports/storage.js'
import { createCrossTabSync } from './sync.js'
import type { CrossTabSyncHandle } from './sync.js'
import type { ClosableStoragePort } from './local-storage.js'

/**
 * Initialization options for {@link createSessionStorageAdapter}.
 */
export interface SessionStorageAdapterInit {
    /**
     * Fixed backend override, primarily a test seam. `undefined` (the
     * default) resolves `window.sessionStorage` lazily per operation;
     * explicit `null` forces every operation to report `unavailable` without
     * touching any global, which is how server-like absence is simulated.
     */
    readonly backend?: Storage | null
}

/**
 * Reads the Web Locks-free backend surface without probing writes: only the
 * presence of the three CRUD functions is required, so exotic shims qualify.
 *
 * @param candidate Value to test.
 * @returns True when the value quacks like a `Storage` backend.
 */
function isStorageLike(candidate: unknown): boolean {
    if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
        return false
    }
    const record = candidate as Record<string, unknown>
    return typeof record['getItem'] === 'function' && typeof record['setItem'] === 'function' && typeof record['removeItem'] === 'function'
}

/**
 * Resolves `window.sessionStorage`, then the `globalThis` fallback, without
 * ever throwing. Blocked or absent storage degrades to null for the
 * `unavailable` result path.
 *
 * @returns The live backend, or null when none is reachable.
 */
function autoBackend(): Storage | null {
    try {
        if (typeof window !== 'undefined') {
            const candidate = (window as unknown as Record<string, unknown>)['sessionStorage']
            if (isStorageLike(candidate)) {
                return candidate as Storage
            }
        }
    } catch {
        // Blocked access (for example sandboxed iframes) falls through to the next probe.
    }
    try {
        const candidate = (globalThis as unknown as Record<string, unknown>)['sessionStorage']
        if (isStorageLike(candidate)) {
            return candidate as Storage
        }
    } catch {
        // No reachable backend; callers report `unavailable`.
    }
    return null
}

/**
 * Honors cooperative backend failures: a backend may throw a
 * `StorageError`-shaped value to report its failure precisely (used by test
 * shims arming one-shot failures). Returns null for anything else so natural
 * platform errors flow into the structural mapping below.
 *
 * @param error Value thrown by the backend.
 * @returns The precise error, or null when the shape does not match.
 */
function asStorageError(error: unknown): StorageError | null {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
        return null
    }
    const record = error as Record<string, unknown>
    if (record['kind'] === 'unavailable') {
        return { kind: 'unavailable' }
    }
    if (record['kind'] === 'quota') {
        return { kind: 'quota' }
    }
    if (record['kind'] === 'corrupt' && typeof record['raw'] === 'string') {
        return { kind: 'corrupt', raw: record['raw'] }
    }
    if (record['kind'] === 'unknown') {
        return { kind: 'unknown', cause: record['cause'] }
    }
    return null
}

/**
 * Detects quota exhaustion across browsers without `instanceof`, which stays
 * cross-realm fragile.
 *
 * @param error Value thrown by the backend.
 * @returns True for quota-shaped failures.
 */
function isQuotaError(error: unknown): boolean {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
        return false
    }
    const record = error as Record<string, unknown>
    if (record['name'] === 'QuotaExceededError' || record['name'] === 'NS_ERROR_DOM_QUOTA_REACHED') {
        return true
    }
    return record['code'] === 22 || record['code'] === 1014
}

/**
 * Detects denied storage access (for example blocked third-party storage).
 *
 * @param error Value thrown by the backend.
 * @returns True for security-shaped failures.
 */
function isSecurityError(error: unknown): boolean {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
        return false
    }
    return (error as Record<string, unknown>)['name'] === 'SecurityError'
}

/**
 * Maps a read/remove failure to a `StorageResult` error. Never throws.
 *
 * @param error Value thrown by the backend.
 * @returns The mapped storage error.
 */
function mapReadError(error: unknown): StorageError {
    const direct = asStorageError(error)
    if (direct !== null) {
        return direct
    }
    if (isSecurityError(error)) {
        return { kind: 'unavailable' }
    }
    return { kind: 'unknown', cause: error }
}

/**
 * Maps a write failure to a `StorageResult` error, recognizing quota
 * exhaustion in addition to the shared cases. Never throws.
 *
 * @param error Value thrown by the backend.
 * @returns The mapped storage error.
 */
function mapWriteError(error: unknown): StorageError {
    const direct = asStorageError(error)
    if (direct !== null) {
        return direct
    }
    if (isQuotaError(error)) {
        return { kind: 'quota' }
    }
    if (isSecurityError(error)) {
        return { kind: 'unavailable' }
    }
    return { kind: 'unknown', cause: error }
}

/**
 * Stringifies a non-string write payload for the `corrupt` report without
 * ever throwing.
 *
 * @param value Offending payload.
 * @returns A printable rendering of the payload.
 */
function stringifyRaw(value: unknown): string {
    try {
        return String(value)
    } catch {
        return '<unprintable>'
    }
}

/**
 * Creates a `StoragePort` over `window.sessionStorage`. Pure factory: no DOM
 * is touched until the first operation; every method returns a
 * `StorageResult` and never throws. `observe$` emits only external changes
 * (same-tab siblings via `BroadcastChannel`); self-writes persist and
 * broadcast but never reflux. Failed broadcasts stay best-effort.
 *
 * @param init Optional fixed backend override (test seam) or forced absence.
 * @returns The closable storage port.
 * @example
 * ```ts
 * import { createSessionStorageAdapter } from './session-storage.js'
 *
 * const storage = createSessionStorageAdapter()
 * const written = storage.write('app:draft', '{"v":0,"d":{"text":"hi"}}')
 * const seen = storage.observe$('app:draft').subscribe((value) => { void value })
 * seen.unsubscribe()
 * storage.close()
 * ```
 */
export function createSessionStorageAdapter(init: SessionStorageAdapterInit = {}): ClosableStoragePort {
    const override = init.backend
    const subjects = new Map<string, Subject<string | null>>()
    const syncs = new Map<string, CrossTabSyncHandle>()
    let closed = false

    const backend = (): Storage | null => {
        if (override === null) {
            return null
        }
        if (override !== undefined) {
            return override
        }
        return autoBackend()
    }

    const subjectFor = (key: string): Subject<string | null> => {
        const existing = subjects.get(key)
        if (existing !== undefined) {
            return existing
        }
        const created = new Subject<string | null>()
        subjects.set(key, created)
        return created
    }

    const syncFor = (key: string): CrossTabSyncHandle | null => {
        if (closed) {
            return null
        }
        const existing = syncs.get(key)
        if (existing !== undefined) {
            return existing
        }
        const subject = subjectFor(key)
        const handle = createCrossTabSync({
            key,
            onRemote: (value) => {
                if (closed === false) {
                    subject.next(value)
                }
            },
        })
        syncs.set(key, handle)
        return handle
    }

    const port: ClosableStoragePort = {
        read(key: string): StorageResult<string | null> {
            const storage = backend()
            if (storage === null) {
                return { ok: false, error: { kind: 'unavailable' } }
            }
            try {
                return { ok: true, value: storage.getItem(key) }
            } catch (error) {
                return { ok: false, error: mapReadError(error) }
            }
        },
        write(key: string, value: string): StorageResult<void> {
            if (typeof value !== 'string') {
                return { ok: false, error: { kind: 'corrupt', raw: stringifyRaw(value) } }
            }
            const storage = backend()
            if (storage === null) {
                return { ok: false, error: { kind: 'unavailable' } }
            }
            try {
                storage.setItem(key, value)
            } catch (error) {
                return { ok: false, error: mapWriteError(error) }
            }
            try {
                syncFor(key)?.send(value)
            } catch {
                // Cross-tab broadcast is best-effort; persisted bytes remain readable in this tab.
            }
            return { ok: true, value: undefined }
        },
        remove(key: string): StorageResult<void> {
            const storage = backend()
            if (storage === null) {
                return { ok: false, error: { kind: 'unavailable' } }
            }
            try {
                storage.removeItem(key)
            } catch (error) {
                return { ok: false, error: mapReadError(error) }
            }
            try {
                syncFor(key)?.send(null)
            } catch {
                // Cross-tab broadcast is best-effort; the removal already applied locally.
            }
            return { ok: true, value: undefined }
        },
        observe$(key: string): Observable<string | null> {
            if (closed) {
                return EMPTY
            }
            syncFor(key)
            return subjectFor(key).asObservable()
        },
        close(): void {
            if (closed) {
                return
            }
            closed = true
            for (const handle of syncs.values()) {
                try {
                    handle.close()
                } catch {
                    // Sync teardown is best-effort; disposal must not throw.
                }
            }
            syncs.clear()
            for (const subject of subjects.values()) {
                subject.complete()
            }
            subjects.clear()
        },
    }
    return port
}
