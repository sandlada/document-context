import type { IAsyncStorageAdapter, IStorageAdapter } from '../core/types'

/**
 * In-memory `Storage` facade used when Web Storage is unavailable.
 *
 * Backed by a `Map<string, string>` with the full `Storage` surface
 * (`length`, `clear`, `key`, `getItem`, `setItem`, `removeItem`). Values are
 * coerced with `String(value)` on write, matching Web Storage semantics.
 */
class MemoryStorage implements Storage {
    private data = new Map<string, string>()

    get length(): number {
        return this.data.size
    }

    clear(): void {
        this.data.clear()
    }

    getItem(key: string): string | null {
        return this.data.get(key) ?? null
    }

    key(index: number): string | null {
        return Array.from(this.data.keys())[index] ?? null
    }

    removeItem(key: string): void {
        this.data.delete(key)
    }

    setItem(key: string, value: string): void {
        this.data.set(key, String(value))
    }
}

const memoryStorageFallback = new Map<string, Storage>()

/**
 * Resolves a usable `Storage` for `'localStorage'` or `'sessionStorage'`.
 *
 * Probes `window[type]` first, then `globalThis[type]`, verifying each with a
 * `__test_probe__` write-remove round trip (guards private-mode throws and
 * Node 22 without `--localstorage-file`). When every probe fails, returns a
 * process-local in-memory fallback cached per type, so SSR and happy-dom
 * tests keep working without persistence.
 *
 * @param type - Which Web Storage to resolve.
 * @returns A working `Storage` (native or in-memory fallback).
 *
 * @example
 * ```ts
 * import { getStorageInstance } from '@sandlada/document-context'
 *
 * getStorageInstance('localStorage').setItem('k', 'v')
 * ```
 */
export function getStorageInstance(type: 'localStorage' | 'sessionStorage'): Storage {
    try {
        if (typeof window !== 'undefined' && window[type]) {
            const st = window[type]
            st.setItem('__test_probe__', '1')
            st.removeItem('__test_probe__')
            return st
        }
    } catch {
        // In Node 22, global localStorage throws if --localstorage-file is not passed
    }

    try {
        if (typeof globalThis !== 'undefined' && (globalThis as any)[type]) {
            const st = (globalThis as any)[type]
            st.setItem('__test_probe__', '1')
            st.removeItem('__test_probe__')
            return st
        }
    } catch {
        // Fallback
    }

    if (!memoryStorageFallback.has(type)) {
        memoryStorageFallback.set(type, new MemoryStorage())
    }
    return memoryStorageFallback.get(type)!
}

/**
 * Creates a synchronous {@link IStorageAdapter} over `localStorage`.
 *
 * The underlying `Storage` is resolved lazily per call via
 * `getStorageInstance('localStorage')`, so the adapter tracks the
 * environment (native storage when available, in-memory fallback otherwise).
 * Values are stringified on write.
 *
 * @returns An `IStorageAdapter` bound to `localStorage`.
 *
 * @example
 * ```ts
 * import { createLocalStorageAdapter } from '@sandlada/document-context'
 *
 * const adapter = createLocalStorageAdapter()
 * adapter.setItem('k', JSON.stringify({ count: 1 }))
 * ```
 */
export function createLocalStorageAdapter(): IStorageAdapter {
    return {
        getItem(key: string) {
            const storage = getStorageInstance('localStorage')
            return storage.getItem(key)
        },
        setItem(key: string, value: string) {
            const storage = getStorageInstance('localStorage')
            storage.setItem(key, String(value))
        },
        removeItem(key: string) {
            const storage = getStorageInstance('localStorage')
            storage.removeItem(key)
        }
    }
}

/**
 * Creates a synchronous {@link IStorageAdapter} over `sessionStorage`.
 *
 * Same lazy-resolution and stringification contract as
 * `createLocalStorageAdapter()`, scoped to the tab lifetime instead of
 * origin persistence.
 *
 * @returns An `IStorageAdapter` bound to `sessionStorage`.
 *
 * @example
 * ```ts
 * import { createSessionStorageAdapter } from '@sandlada/document-context'
 *
 * const adapter = createSessionStorageAdapter()
 * adapter.setItem('k', 'v')
 * ```
 */
export function createSessionStorageAdapter(): IStorageAdapter {
    return {
        getItem(key: string) {
            const storage = getStorageInstance('sessionStorage')
            return storage.getItem(key)
        },
        setItem(key: string, value: string) {
            const storage = getStorageInstance('sessionStorage')
            storage.setItem(key, String(value))
        },
        removeItem(key: string) {
            const storage = getStorageInstance('sessionStorage')
            storage.removeItem(key)
        }
    }
}

/**
 * Normalizes a `withStorage` adapter option to a concrete adapter object.
 *
 * The `'localStorage'` / `'sessionStorage'` shorthands construct the matching
 * built-in adapter; any other value (custom sync or async object) passes
 * through untouched. No validation is performed here; failures surface later
 * as `InvalidStorageDataError` on the session error stream.
 *
 * @param adapter - Shorthand string or custom sync/async adapter.
 * @returns The resolved `IStorageAdapter` or `IAsyncStorageAdapter`.
 *
 * @example
 * ```ts
 * import { getStorageAdapter } from '@sandlada/document-context'
 *
 * const adapter = getStorageAdapter('localStorage')
 * ```
 */
export function getStorageAdapter(
    adapter: 'localStorage' | 'sessionStorage' | IStorageAdapter<any> | IAsyncStorageAdapter<any>
): IStorageAdapter<any> | IAsyncStorageAdapter<any> {
    if (adapter === 'localStorage') {
        return createLocalStorageAdapter()
    }
    if (adapter === 'sessionStorage') {
        return createSessionStorageAdapter()
    }
    return adapter
}

/**
 * Serializes state into the versioned `{"__v", "data"}` envelope.
 *
 * Every persistence write goes through this function, so readers can detect
 * stale schemas via `__v` and migrate. `data` is embedded as-is (no schema
 * filtering); `version` defaults to `1`.
 *
 * @param data - State (or partial state) to persist.
 * @param version - Schema version stamped as `__v`. Defaults to `1`.
 * @returns The JSON string payload.
 *
 * @example
 * ```ts
 * import { serializeWithVersion } from '@sandlada/document-context'
 *
 * localStorage.setItem('counter', serializeWithVersion({ count: 1 }, 2))
 * ```
 */
export function serializeWithVersion(data: any, version = 1): string {
    return JSON.stringify({
        __v: version,
        data
    })
}

/**
 * Deserializes a versioned payload, migrating stale schemas when asked.
 *
 * `null` / `undefined` input yields `null` (no data). Enveloped payloads
 * (`{__v, data}`) return `data` directly when `__v >= targetVersion`, or
 * `migrate(data, __v)` when older and a `migrate` function is supplied (no
 * migrate function means the stale data is returned as-is). Legacy bare JSON
 * without an envelope returns parsed as-is. Malformed JSON throws and is
 * converted upstream to `InvalidStorageDataError`.
 *
 * @param raw - Raw storage string, or `null` when the key is absent.
 * @param targetVersion - Expected schema version. Defaults to `1`.
 * @param migrate - Optional `(oldData, oldVersion) => migrated` upgrader.
 * @returns The hydrated data, migrated when applicable, or `null` for absent
 * input.
 * @throws {SyntaxError} When `raw` is not valid JSON.
 *
 * @example
 * ```ts
 * import { deserializeWithMigration } from '@sandlada/document-context'
 *
 * const data = deserializeWithMigration(raw, 2, (old, v) => ({ count: Number(old.count) || 0 }))
 * ```
 */
export function deserializeWithMigration(
    raw: string | null,
    targetVersion = 1,
    migrate?: (oldData: any, oldVersion: number) => any
): any {
    if (raw === null || raw === undefined) {
        return null
    }

    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && '__v' in parsed && 'data' in parsed) {
        const currentV = Number(parsed.__v) || 0
        if (currentV < targetVersion && typeof migrate === 'function') {
            return migrate(parsed.data, currentV)
        }
        return parsed.data
    }

    return parsed
}
