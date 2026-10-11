import { describe, expect, it } from 'vitest'
import { DocumentContextError } from '../model/errors.js'
import { createFakeStorage } from '../testing/fakes.js'
import type { StoragePort, StorageResult } from '../ports/storage.js'
import { hydrateState } from './hydrate.js'

type State = {
    count: number
    theme: string
}

const seed = (): State => ({ count: 0, theme: 'light' })

const envelope = (v: number, d: unknown): string => JSON.stringify({ v, d })

describe('hydrateState fresh and storage-first paths', () => {
    it('returns a seed copy as fresh when storage and payload are absent', async () => {
        const initial = seed()
        const result = await hydrateState<State>({ blueprintInitial: initial })
        expect(result.state).toEqual(seed())
        expect(result.state).not.toBe(initial)
        expect(result.outcome).toBe('fresh')
        expect(result.errors).toEqual([])
        expect(result.writeBlocked).toBe(false)
    })

    it('adopts storage on version match with storageFirst (storage wins over payload)', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(2, { count: 5, theme: 'dark' }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            payload: { count: 9, theme: 'payload-theme' },
            strategy: 'storageFirst',
            version: 2,
        })
        expect(result.state).toEqual({ count: 5, theme: 'dark' })
        expect(result.outcome).toBe('storage')
        expect(result.errors).toEqual([])
    })

    it('falls through payload holes to storage then seed', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(0, { count: 7 }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            payload: { theme: 'dark' },
            strategy: 'payloadFirst',
            version: 0,
        })
        expect(result.state).toEqual({ count: 7, theme: 'dark' })
    })

    it('lets payload win under payloadFirst', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(0, { count: 1, theme: 'stored' }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            payload: { count: 2, theme: 'from-payload' },
            strategy: 'payloadFirst',
            version: 0,
        })
        expect(result.state).toEqual({ count: 2, theme: 'from-payload' })
        expect(result.outcome).toBe('payload')
    })

    it('lets the seed win under blueprintFirst while keeping union keys', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(0, { count: 9, theme: 'stored' }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            payload: { count: 8, theme: 'payload' },
            strategy: 'blueprintFirst',
            version: 0,
        })
        expect(result.state).toEqual(seed())
    })

    it('shallow-merges blueprint, storage, then payload under merge with nested wholesale', async () => {
        type Nested = { count: number, nested: { a: number, b: number } }
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(0, { count: 3, nested: { a: 9 } }))
        const result = await hydrateState<Nested>({
            blueprintInitial: { count: 0, nested: { a: 1, b: 2 } },
            storage: { port: storage.port, key: 'app:key' },
            payload: { nested: { a: 0, b: 0 } } as unknown as Record<string, unknown>,
            strategy: 'merge',
            version: 0,
        })
        expect(result.state).toEqual({ count: 3, nested: { a: 0, b: 0 } })
        expect(result.outcome).toBe('merged')
    })

    it('backfills missing keys from the seed (seed-fill)', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(0, { count: 4 }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            strategy: 'storageFirst',
            version: 0,
        })
        expect(result.state).toEqual({ count: 4, theme: 'light' })
    })
})

describe('hydrateState fault tolerance', () => {
    it('treats storage read failures as a miss without errors', async () => {
        const storage = createFakeStorage()
        storage.failNext('unavailable')
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            payload: { count: 6, theme: 'dark' },
            strategy: 'storageFirst',
            version: 0,
        })
        expect(result.state).toEqual({ count: 6, theme: 'dark' })
        expect(result.errors).toEqual([])
    })

    it('downgrades corrupt envelopes to seed with INVALID_STORAGE_DATA', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', '<not-json')
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            strategy: 'storageFirst',
            version: 0,
        })
        expect(result.state).toEqual(seed())
        expect(result.outcome).toBe('invalid-downgraded')
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0]).toBeInstanceOf(DocumentContextError)
        expect(result.errors[0]?.code).toBe('INVALID_STORAGE_DATA')
    })

    it('downgrades non-object envelopes to seed with INVALID_STORAGE_DATA', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', JSON.stringify({ v: 0, d: 42 }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            version: 0,
        })
        expect(result.outcome).toBe('invalid-downgraded')
        expect(result.errors[0]?.code).toBe('INVALID_STORAGE_DATA')
    })

    it('supports MaybePromise (async) storage backends', async () => {
        const asyncPort: StoragePort = {
            read: (key: string): Promise<StorageResult<string | null>> => {
                void key
                return Promise.resolve({ ok: true, value: envelope(0, { count: 11, theme: 'async' }) })
            },
            write: () => Promise.resolve({ ok: true, value: undefined }),
            remove: () => Promise.resolve({ ok: true, value: undefined }),
            observe$: () => createFakeStorage().port.observe$('app:key'),
        }
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: asyncPort, key: 'app:key' },
            strategy: 'storageFirst',
            version: 0,
        })
        expect(result.state).toEqual({ count: 11, theme: 'async' })
        expect(result.outcome).toBe('storage')
    })
})

describe('hydrateState versions and migration', () => {
    it('migrates older storage with a sync single-step migrate (storage-only)', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(1, { count: 2 }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            strategy: 'storageFirst',
            version: 2,
            migrate: (persisted, oldVersion) => {
                expect(oldVersion).toBe(1)
                const snapshot = persisted as Partial<State>
                return { count: snapshot.count ?? 0, theme: 'light' }
            },
        })
        expect(result.state).toEqual({ count: 2, theme: 'light' })
        expect(result.outcome).toBe('migrated')
        expect(result.errors).toEqual([])
    })

    it('keeps migrate output on the storage side with unchanged priority', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(1, { count: 2, theme: 'old' }))
        const payloadFirst = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            payload: { count: 99, theme: 'payload-wins' },
            strategy: 'payloadFirst',
            version: 2,
            migrate: () => ({ count: 2, theme: 'migrated' }),
        })
        expect(payloadFirst.state).toEqual({ count: 99, theme: 'payload-wins' })
        expect(payloadFirst.outcome).toBe('migrated')
    })

    it('downgrades when no migrate is provided for older versions', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(1, { count: 2 }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            version: 2,
        })
        expect(result.state).toEqual(seed())
        expect(result.outcome).toBe('invalid-downgraded')
        expect(result.errors[0]?.code).toBe('INVALID_STORAGE_DATA')
    })

    it('downgrades when migrate throws, keeping the mount alive', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(0, { count: 1 }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            version: 1,
            migrate: () => {
                throw new Error('migrate-boom')
            },
        })
        expect(result.state).toEqual(seed())
        expect(result.outcome).toBe('invalid-downgraded')
        expect(result.errors[0]?.code).toBe('INVALID_STORAGE_DATA')
    })

    it('blocks newer versions: discards storage, guards writes, merges the rest', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(5, { count: 99, theme: 'future' }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            payload: { count: 3, theme: 'payload' },
            strategy: 'storageFirst',
            version: 2,
        })
        expect(result.state).toEqual({ count: 3, theme: 'payload' })
        expect(result.outcome).toBe('newer-blocked')
        expect(result.writeBlocked).toBe(true)
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0]?.code).toBe('INVALID_STORAGE_DATA')
        expect(result.errors[0]?.details).toMatchObject({ storageVersionGuard: 'newer-blocked' })
    })

    it('defaults the expected version to 0', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(0, { count: 8, theme: 'dark' }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
        })
        expect(result.state).toEqual({ count: 8, theme: 'dark' })
        expect(result.outcome).toBe('storage')
    })

    it('downgrades when migrate returns a non-record, keeping the mount alive', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(1, { count: 2 }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            version: 2,
            migrate: () => 42 as unknown as Partial<State>,
        })
        expect(result.state).toEqual(seed())
        expect(result.outcome).toBe('invalid-downgraded')
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0]?.code).toBe('INVALID_STORAGE_DATA')
        expect(result.writeBlocked).toBe(false)
    })
})

describe('hydrateState strategy sides and fresh outcomes', () => {
    it('resolves storage under payloadFirst when the payload is absent', async () => {
        const storage = createFakeStorage()
        await storage.port.write('app:key', envelope(0, { count: 5, theme: 'stored' }))
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:key' },
            strategy: 'payloadFirst',
            version: 0,
        })
        expect(result.state).toEqual({ count: 5, theme: 'stored' })
        expect(result.outcome).toBe('storage')
        expect(result.errors).toEqual([])
    })

    it('returns fresh under payloadFirst when storage and payload are absent', async () => {
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            strategy: 'payloadFirst',
        })
        expect(result.state).toEqual(seed())
        expect(result.outcome).toBe('fresh')
        expect(result.errors).toEqual([])
    })

    it('returns fresh under blueprintFirst when storage and payload are absent', async () => {
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            strategy: 'blueprintFirst',
        })
        expect(result.state).toEqual(seed())
        expect(result.outcome).toBe('fresh')
        expect(result.errors).toEqual([])
    })

    it('returns fresh under merge when storage and payload are absent', async () => {
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            strategy: 'merge',
        })
        expect(result.state).toEqual(seed())
        expect(result.outcome).toBe('fresh')
        expect(result.errors).toEqual([])
    })

    it('adopts a lone payload side under merge with seed backfill', async () => {
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            payload: { count: 9 },
            strategy: 'merge',
        })
        expect(result.state).toEqual({ count: 9, theme: 'light' })
        expect(result.outcome).toBe('merged')
        expect(result.errors).toEqual([])
    })

    it('returns fresh under payloadFirst when the storage read misses and the payload is absent', async () => {
        const storage = createFakeStorage()
        const result = await hydrateState<State>({
            blueprintInitial: seed(),
            storage: { port: storage.port, key: 'app:missing' },
            strategy: 'payloadFirst',
            version: 0,
        })
        expect(result.state).toEqual(seed())
        expect(result.outcome).toBe('fresh')
    })
})
