import { describe, expect, it } from 'vitest'
import { createSessionState } from '../domain/model/session.js'
import type { SessionState } from '../domain/model/session.js'
import type { DocumentContextError } from '../domain/model/errors.js'
import type { MaybePromise, StorageResult } from '../domain/ports/storage.js'
import { createFakeScheduler } from '../domain/testing/fakes.js'
import type { FakeScheduler } from '../domain/testing/fakes.js'
import { createPersistWiring } from './persist-wiring.js'
import type { PersistWiring } from './persist-wiring.js'

type Snapshot = { count: number }

interface Harness {
    readonly store: SessionState<Snapshot>
    readonly scheduler: FakeScheduler
    readonly errors: Array<DocumentContextError>
    readonly writes: Array<Snapshot>
    readonly seen: Array<Snapshot>
    readonly wiring: PersistWiring<Snapshot>
    setBlocked(blocked: boolean): void
    setWriteImpl(impl: (snapshot: Snapshot) => MaybePromise<StorageResult<void>>): void
}

interface SetupOverrides {
    readonly blocked?: boolean
    readonly decide?: (local: Snapshot, remote: Snapshot) => Snapshot | 'ignore'
    readonly isEqual?: (a: Snapshot, b: Snapshot) => boolean
}

const okWrite = (_snapshot: Snapshot): StorageResult<void> => ({ ok: true, value: undefined })

const quotaWrite = (_snapshot: Snapshot): StorageResult<void> => ({ ok: false, error: { kind: 'quota' } })

const asyncOkWrite = async (_snapshot: Snapshot): Promise<StorageResult<void>> => ({ ok: true, value: undefined })

const asyncQuotaWrite = async (_snapshot: Snapshot): Promise<StorageResult<void>> => ({ ok: false, error: { kind: 'quota' } })

const throwingWrite = (_snapshot: Snapshot): StorageResult<void> => {
    throw new Error('serialize-boom')
}

const rejectingWrite = async (_snapshot: Snapshot): Promise<StorageResult<void>> => {
    throw new Error('async-boom')
}

const setup = (overrides: SetupOverrides = {}): Harness => {
    const store = createSessionState({ count: 0 })
    const scheduler = createFakeScheduler()
    const errors: Array<DocumentContextError> = []
    const writes: Array<Snapshot> = []
    const seen: Array<Snapshot> = []
    const box: {
        blocked: boolean
        writeImpl: (snapshot: Snapshot) => MaybePromise<StorageResult<void>>
    } = {
        blocked: overrides.blocked ?? false,
        writeImpl: okWrite,
    }
    const wiring = createPersistWiring<Snapshot>({
        state$: store.state$,
        getSnapshot: (): Snapshot => store.getSnapshot(),
        setState: (next: Snapshot): void => {
            store.setState(next)
        },
        scheduler,
        write: (snapshot: Snapshot): MaybePromise<StorageResult<void>> => {
            writes.push({ ...snapshot })
            return box.writeImpl(snapshot)
        },
        isBlocked: (): boolean => box.blocked,
        report: (error: DocumentContextError): void => {
            errors.push(error)
        },
        ...(overrides.decide !== undefined ? { decide: overrides.decide } : {}),
        ...(overrides.isEqual !== undefined ? { isEqual: overrides.isEqual } : {}),
    })
    store.state$.subscribe((snapshot: Snapshot) => {
        seen.push({ ...snapshot })
    })
    return {
        store,
        scheduler,
        errors,
        writes,
        seen,
        wiring,
        setBlocked: (blocked: boolean): void => {
            box.blocked = blocked
        },
        setWriteImpl: (impl: (snapshot: Snapshot) => MaybePromise<StorageResult<void>>): void => {
            box.writeImpl = impl
        },
    }
}

const tick = async (rounds = 10): Promise<void> => {
    for (let index = 0; index < rounds; index += 1) {
        await Promise.resolve()
    }
}

describe('persist-wiring write-back', () => {
    it('skips the hydrated first value without a write-back', () => {
        const harness = setup()
        expect(harness.scheduler.pendingMicrotasks()).toBe(0)
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([])
        expect(harness.errors).toEqual([])
    })

    it('coalesces rapid updates into one microtask write of the latest snapshot', () => {
        const harness = setup()
        harness.store.update({ count: 1 })
        harness.store.update({ count: 2 })
        expect(harness.scheduler.pendingMicrotasks()).toBe(1)
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 2 }])
        expect(harness.errors).toEqual([])
    })

    it('schedules a fresh microtask for updates after a flush', () => {
        const harness = setup()
        harness.store.update({ count: 1 })
        harness.scheduler.flushMicrotasks()
        harness.store.update({ count: 2 })
        expect(harness.scheduler.pendingMicrotasks()).toBe(1)
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 1 }, { count: 2 }])
    })

    it('flush writes the current snapshot immediately and subsumes the pending microtask', () => {
        const harness = setup()
        harness.store.update({ count: 3 })
        expect(harness.wiring.flush()).toBeUndefined()
        expect(harness.writes).toEqual([{ count: 3 }])
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 3 }])
    })

    it('reports newer-blocked writes once until unblock resets the latch', () => {
        const harness = setup({ blocked: true })
        harness.store.update({ count: 1 })
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([])
        expect(harness.errors).toHaveLength(1)
        expect(harness.errors[0]?.code).toBe('INVALID_STORAGE_DATA')
        expect(harness.errors[0]?.details).toEqual({ op: 'write', guarded: true })
        harness.store.update({ count: 2 })
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([])
        expect(harness.errors).toHaveLength(1)
        harness.setBlocked(false)
        harness.store.update({ count: 3 })
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 3 }])
        expect(harness.errors).toHaveLength(1)
        harness.setBlocked(true)
        harness.store.update({ count: 4 })
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 3 }])
        expect(harness.errors).toHaveLength(2)
        expect(harness.errors[1]?.details).toEqual({ op: 'write', guarded: true })
    })

    it('reports a quota failure once until a success resets the latch', () => {
        const harness = setup()
        harness.setWriteImpl(quotaWrite)
        harness.store.update({ count: 1 })
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 1 }])
        expect(harness.errors).toHaveLength(1)
        expect(harness.errors[0]?.code).toBe('INVALID_STORAGE_DATA')
        expect(harness.errors[0]?.details).toMatchObject({ op: 'write' })
        harness.store.update({ count: 2 })
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 1 }, { count: 2 }])
        expect(harness.errors).toHaveLength(1)
        harness.setWriteImpl(okWrite)
        harness.store.update({ count: 3 })
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 1 }, { count: 2 }, { count: 3 }])
        expect(harness.errors).toHaveLength(1)
        harness.setWriteImpl(quotaWrite)
        harness.store.update({ count: 4 })
        harness.scheduler.flushMicrotasks()
        expect(harness.errors).toHaveLength(2)
    })

    it('supports async backends with best-effort reporting', async () => {
        const harness = setup()
        harness.setWriteImpl(asyncOkWrite)
        harness.store.update({ count: 1 })
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 1 }])
        expect(harness.errors).toEqual([])
        await tick()
        expect(harness.errors).toEqual([])
        harness.setWriteImpl(asyncQuotaWrite)
        harness.store.update({ count: 2 })
        harness.scheduler.flushMicrotasks()
        await tick()
        expect(harness.writes).toEqual([{ count: 1 }, { count: 2 }])
        expect(harness.errors).toHaveLength(1)
        expect(harness.errors[0]?.code).toBe('INVALID_STORAGE_DATA')
    })

    it('returns an awaitable promise from flush for async backends', async () => {
        const harness = setup()
        harness.setWriteImpl(asyncOkWrite)
        harness.store.update({ count: 4 })
        await harness.wiring.flush()
        expect(harness.writes).toEqual([{ count: 4 }])
        expect(harness.errors).toEqual([])
    })

    it('converts sync throws and async rejections into INVALID_STORAGE_DATA without throwing', async () => {
        const harness = setup()
        harness.setWriteImpl(throwingWrite)
        harness.store.update({ count: 1 })
        expect(() => harness.scheduler.flushMicrotasks()).not.toThrow()
        expect(harness.errors).toHaveLength(1)
        expect(harness.errors[0]?.code).toBe('INVALID_STORAGE_DATA')
        expect(harness.errors[0]?.details).toMatchObject({ op: 'write' })
        expect(harness.wiring.flush()).toBeUndefined()
        expect(harness.errors).toHaveLength(1)
        harness.setWriteImpl(okWrite)
        harness.store.update({ count: 2 })
        harness.scheduler.flushMicrotasks()
        expect(harness.errors).toHaveLength(1)
        harness.setWriteImpl(rejectingWrite)
        harness.store.update({ count: 3 })
        harness.scheduler.flushMicrotasks()
        await tick()
        expect(harness.errors).toHaveLength(2)
        expect(harness.errors[1]?.code).toBe('INVALID_STORAGE_DATA')
    })

    it('applies remote snapshots with default last-write-wins without a write-back echo', () => {
        const harness = setup()
        harness.store.update({ count: 1 })
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 1 }])
        harness.wiring.onRemote({ count: 5 })
        expect(harness.store.getSnapshot()).toEqual({ count: 5 })
        expect(harness.seen).toEqual([{ count: 0 }, { count: 1 }, { count: 5 }])
        expect(harness.scheduler.pendingMicrotasks()).toBe(0)
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 1 }])
        expect(harness.errors).toEqual([])
    })

    it('drops remote snapshots when decide returns ignore', () => {
        const harness = setup({ decide: (_local: Snapshot, _remote: Snapshot) => 'ignore' })
        harness.store.update({ count: 1 })
        harness.scheduler.flushMicrotasks()
        harness.wiring.onRemote({ count: 9 })
        expect(harness.store.getSnapshot()).toEqual({ count: 1 })
        expect(harness.seen).toEqual([{ count: 0 }, { count: 1 }])
        expect(harness.scheduler.pendingMicrotasks()).toBe(0)
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 1 }])
    })

    it('drops remote snapshots equal to local state', () => {
        const harness = setup()
        harness.store.update({ count: 1 })
        harness.scheduler.flushMicrotasks()
        harness.wiring.onRemote({ count: 1 })
        expect(harness.seen).toEqual([{ count: 0 }, { count: 1 }])
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 1 }])
        expect(harness.errors).toEqual([])
    })

    it('honours a custom decide merge without echo', () => {
        const harness = setup({
            decide: (local: Snapshot, remote: Snapshot) => ({ count: local.count + remote.count }),
            isEqual: (a: Snapshot, b: Snapshot) => a.count === b.count,
        })
        harness.wiring.onRemote({ count: 4 })
        expect(harness.store.getSnapshot()).toEqual({ count: 4 })
        expect(harness.scheduler.pendingMicrotasks()).toBe(0)
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([])
    })

    it('drops everything when a custom isEqual always matches', () => {
        const harness = setup({ isEqual: (_a: Snapshot, _b: Snapshot) => true })
        harness.wiring.onRemote({ count: 7 })
        expect(harness.store.getSnapshot()).toEqual({ count: 0 })
        expect(harness.seen).toEqual([{ count: 0 }])
        expect(harness.scheduler.pendingMicrotasks()).toBe(0)
    })

    it('keeps the echo guard scoped to the remote apply so later local updates still persist', () => {
        const harness = setup()
        harness.wiring.onRemote({ count: 5 })
        expect(harness.scheduler.pendingMicrotasks()).toBe(0)
        harness.store.update({ count: 6 })
        expect(harness.scheduler.pendingMicrotasks()).toBe(1)
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 6 }])
    })

    it('ignores remote snapshots after dispose', () => {
        const harness = setup()
        harness.wiring.dispose()
        harness.wiring.onRemote({ count: 3 })
        expect(harness.store.getSnapshot()).toEqual({ count: 0 })
        expect(harness.writes).toEqual([{ count: 0 }])
    })

    it('dispose cancels the pending microtask and performs one final flush', () => {
        const harness = setup()
        harness.store.update({ count: 1 })
        expect(harness.scheduler.pendingMicrotasks()).toBe(1)
        expect(harness.wiring.dispose()).toBeUndefined()
        expect(harness.writes).toEqual([{ count: 1 }])
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 1 }])
        harness.store.update({ count: 2 })
        expect(harness.scheduler.pendingMicrotasks()).toBe(0)
        harness.scheduler.flushMicrotasks()
        expect(harness.writes).toEqual([{ count: 1 }])
        expect(harness.wiring.dispose()).toBeUndefined()
        expect(harness.writes).toEqual([{ count: 1 }])
    })

    it('dispose flushes even without pending updates', () => {
        const harness = setup()
        harness.wiring.dispose()
        expect(harness.writes).toEqual([{ count: 0 }])
    })

    it('dispose reports async flush failures fire-and-forget', async () => {
        const harness = setup()
        harness.setWriteImpl(asyncQuotaWrite)
        harness.store.update({ count: 1 })
        await harness.wiring.dispose()
        expect(harness.errors).toHaveLength(1)
        expect(harness.errors[0]?.code).toBe('INVALID_STORAGE_DATA')
    })

    it('treats pre-creation history as hydrated seed and applies queued remote updates without echo', async () => {
        const store = createSessionState({ count: 0 })
        store.update({ count: 1 })
        store.update({ count: 2 })
        const scheduler = createFakeScheduler()
        const errors: Array<DocumentContextError> = []
        const writes: Array<Snapshot> = []
        const wiring = createPersistWiring<Snapshot>({
            state$: store.state$,
            getSnapshot: (): Snapshot => store.getSnapshot(),
            setState: (next: Snapshot): void => {
                store.setState(next)
            },
            scheduler,
            write: (snapshot: Snapshot): MaybePromise<StorageResult<void>> => {
                writes.push({ ...snapshot })
                return okWrite(snapshot)
            },
            isBlocked: (): boolean => false,
            report: (error: DocumentContextError): void => {
                errors.push(error)
            },
        })
        scheduler.flushMicrotasks()
        expect(writes).toEqual([])
        wiring.onRemote({ count: 9 })
        expect(store.getSnapshot()).toEqual({ count: 9 })
        scheduler.flushMicrotasks()
        expect(writes).toEqual([])
        expect(errors).toEqual([])
        await wiring.dispose()
        expect(writes).toEqual([{ count: 9 }])
    })
})
