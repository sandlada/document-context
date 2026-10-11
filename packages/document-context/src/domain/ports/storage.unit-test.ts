import { describe, expect, it } from 'vitest'
import { Subject } from 'rxjs'
import type {
    StorageError,
    StorageKeywords,
    StorageOptions,
    StoragePort,
    StorageResult,
} from './storage.js'

/**
 * In-memory `StoragePort` with drivers for external changes and one-shot
 * failures. Synchronous by default and never throws: failures surface as
 * `{ ok: false, error }` results.
 */
export interface FakeStorageHandle {
    /** Port under contract test. */
    readonly port: StoragePort
    /**
     * Simulates an external (cross-tab) change: updates the stored value and
     * notifies `observe$` subscribers, unlike a self-write which stays silent.
     *
     * @param key Storage key.
     * @param value New external value, or null for an external removal.
     */
    emitExternal(key: string, value: string | null): void
    /**
     * Arms a one-shot failure for the next `read`, `write`, or `remove` call.
     * The failure is consumed exactly once, then operations succeed again.
     *
     * @param kind Error kind reported by the next operation.
     */
    failNext(kind: StorageError['kind']): void
}

/**
 * Creates an in-memory storage handle. No DOM access, no timers.
 *
 * @returns A controllable fake storage handle.
 * @example
 * ```ts
 * import { createFakeStorage } from './storage.unit-test.js'
 *
 * const handle = createFakeStorage()
 * ```
 */
export function createFakeStorage(): FakeStorageHandle {
    const store = new Map<string, string>()
    const subjects = new Map<string, Subject<string | null>>()
    let armed: StorageError | null = null

    const errorFor = (kind: StorageError['kind']): StorageError => {
        switch (kind) {
            case 'unavailable':
                return { kind: 'unavailable' }
            case 'corrupt':
                return { kind: 'corrupt', raw: '<garbage' }
            case 'quota':
                return { kind: 'quota' }
            case 'unknown':
                return { kind: 'unknown', cause: 'boom' }
        }
    }

    const takeArmed = (): StorageError | null => {
        const failure = armed
        armed = null
        return failure
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

    const port: StoragePort = {
        read(key) {
            const failure = takeArmed()
            if (failure !== null) {
                return { ok: false, error: failure }
            }
            return { ok: true, value: store.get(key) ?? null }
        },
        write(key, value) {
            const failure = takeArmed()
            if (failure !== null) {
                return { ok: false, error: failure }
            }
            store.set(key, value)
            return { ok: true, value: undefined }
        },
        remove(key) {
            const failure = takeArmed()
            if (failure !== null) {
                return { ok: false, error: failure }
            }
            store.delete(key)
            return { ok: true, value: undefined }
        },
        observe$(key) {
            return subjectFor(key).asObservable()
        },
    }

    return {
        port,
        emitExternal(key, value) {
            if (value === null) {
                store.delete(key)
            } else {
                store.set(key, value)
            }
            subjects.get(key)?.next(value)
        },
        failNext(kind) {
            armed = errorFor(kind)
        },
    }
}

/**
 * Reusable `StoragePort` contract suite. Every adapter (memory, localStorage,
 * IndexedDB) runs the same assertions by supplying a controllable handle.
 *
 * @param create Factory returning a fresh controllable handle per test.
 * @example
 * ```ts
 * import { describe } from 'vitest'
 * import { createFakeStorage, storagePortContract } from './storage.unit-test.js'
 *
 * describe('fake storage', () => {
 *     storagePortContract(createFakeStorage)
 * })
 * ```
 */
export function storagePortContract(create: () => FakeStorageHandle): void {
    it('reads a missing key as { ok: true, value: null }', async () => {
        const { port } = create()
        const missing: StorageResult<string | null> = await port.read('app:missing')
        expect(missing).toEqual({ ok: true, value: null })
    })

    it('round-trips written strings through read', async () => {
        const { port } = create()
        const written: StorageResult<void> = await port.write('app:greeting', 'hello')
        expect(written).toEqual({ ok: true, value: undefined })
        const readBack: StorageResult<string | null> = await port.read('app:greeting')
        expect(readBack).toEqual({ ok: true, value: 'hello' })
    })

    it('reads null after remove', async () => {
        const { port } = create()
        await port.write('app:temp', 'bye')
        const removed: StorageResult<void> = await port.remove('app:temp')
        expect(removed).toEqual({ ok: true, value: undefined })
        const missing: StorageResult<string | null> = await port.read('app:temp')
        expect(missing).toEqual({ ok: true, value: null })
    })

    it('keeps keys isolated from each other', async () => {
        const { port } = create()
        await port.write('app:a', 'for-a')
        const other: StorageResult<string | null> = await port.read('app:b')
        expect(other).toEqual({ ok: true, value: null })
    })

    it('never throws: failures surface as { ok: false, error } results', async () => {
        const handle = create()
        handle.failNext('unavailable')
        const failedRead: StorageResult<string | null> = await handle.port.read('app:key')
        expect(failedRead).toEqual({ ok: false, error: { kind: 'unavailable' } })
        handle.failNext('quota')
        const failedWrite: StorageResult<void> = await handle.port.write('app:key', 'x')
        expect(failedWrite).toEqual({ ok: false, error: { kind: 'quota' } })
        handle.failNext('corrupt')
        const failedRemove: StorageResult<void> = await handle.port.remove('app:key')
        expect(failedRemove).toEqual({ ok: false, error: { kind: 'corrupt', raw: '<garbage' } })
        handle.failNext('unknown')
        const failedUnknown: StorageResult<string | null> = await handle.port.read('app:key')
        expect(failedUnknown).toEqual({ ok: false, error: { kind: 'unknown', cause: 'boom' } })
        const recovered: StorageResult<string | null> = await handle.port.read('app:key')
        expect(recovered).toEqual({ ok: true, value: null })
    })

    it('emits external changes through observe$ without refluxing self-writes', async () => {
        const handle = create()
        const seen: Array<string | null> = []
        const subscription = handle.port.observe$('app:key').subscribe((value) => {
            seen.push(value)
        })
        await handle.port.write('app:key', 'self-write')
        expect(seen).toEqual([])
        handle.emitExternal('app:key', 'remote-write')
        expect(seen).toEqual(['remote-write'])
        const readBack: StorageResult<string | null> = await handle.port.read('app:key')
        expect(readBack).toEqual({ ok: true, value: 'remote-write' })
        handle.emitExternal('app:key', null)
        expect(seen).toEqual(['remote-write', null])
        subscription.unsubscribe()
    })

    it('isolates observe$ streams per key', () => {
        const handle = create()
        const seenA: Array<string | null> = []
        const seenB: Array<string | null> = []
        const subscriptionA = handle.port.observe$('app:a').subscribe((value) => {
            seenA.push(value)
        })
        const subscriptionB = handle.port.observe$('app:b').subscribe((value) => {
            seenB.push(value)
        })
        handle.emitExternal('app:a', 'for-a')
        expect(seenA).toEqual(['for-a'])
        expect(seenB).toEqual([])
        subscriptionA.unsubscribe()
        subscriptionB.unsubscribe()
    })
}

describe('StorageOptions', () => {
    it('accepts keyword storage with hydration, version, migration, and conflict policy', () => {
        const options: StorageOptions<{ count: number }> = {
            storage: 'localStorage',
            key: 'app:counter',
            hydration: 'storageFirst',
            version: 2,
            migrate: (persisted, oldVersion) => {
                expect(oldVersion).toBe(1)
                const snapshot = persisted as Partial<{ count: number }>
                return { count: snapshot.count ?? 0 }
            },
            crossTab: true,
            conflict: 'lww',
        }
        expect(options.storage).toBe('localStorage')
        expect(options.key).toBe('app:counter')
        expect(options.migrate?.({ count: 3 }, 1)).toEqual({ count: 3 })
        expect(options.migrate?.({}, 1)).toEqual({ count: 0 })
    })

    it('accepts a custom StoragePort with a merge conflict function', () => {
        const { port } = createFakeStorage()
        const mergeCounts = (local: { count: number }, remote: { count: number }): { count: number } => ({
            count: local.count + remote.count,
        })
        const options: StorageOptions<{ count: number }> = {
            storage: port,
            key: 'app:counter',
            hydration: 'merge',
            conflict: mergeCounts,
        }
        expect(options.storage).toBe(port)
        expect(mergeCounts({ count: 1 }, { count: 2 })).toEqual({ count: 3 })
    })

    it('requires only storage and key, and defaults the state shape', () => {
        const minimal: StorageOptions = {
            storage: 'sessionStorage',
            key: 'app:minimal',
        }
        expect(minimal.storage).toBe('sessionStorage')
        expect(minimal.hydration).toBeUndefined()
        const keywords: StorageKeywords = { localStorage: true, sessionStorage: true }
        const keyword: keyof StorageKeywords = 'sessionStorage'
        expect(keywords[keyword]).toBe(true)
    })
})

describe('FakeStorage (in-memory storage)', () => {
    storagePortContract(createFakeStorage)
})
