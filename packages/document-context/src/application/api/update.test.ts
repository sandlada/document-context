import { describe, expect, it } from 'vitest'
import { createSessionState } from '../../domain/index.js'
import type { MountSessionRecord, Session } from '../../domain/index.js'
import { createUpdate } from './update.js'
import type { UpdateContext } from './update.js'

type AnyRecord = MountSessionRecord<Record<PropertyKey, unknown>>

const setup = (): {
    readonly ctx: UpdateContext
    readonly session: <S extends Record<PropertyKey, unknown>>(initial: S) => {
        readonly facade: Session<S, unknown>
        readonly record: MountSessionRecord<S>
    }
} => {
    const records = new WeakMap<object, AnyRecord>()
    const ctx: UpdateContext = { records }
    const session = <S extends Record<PropertyKey, unknown>>(initial: S): {
        readonly facade: Session<S, unknown>
        readonly record: MountSessionRecord<S>
    } => {
        const store = createSessionState<S>({ ...initial })
        const record = {
            status: 'mounted',
            sessionState: store,
        } as unknown as MountSessionRecord<S>
        const facade = { state$: store.state$ } as unknown as Session<S, unknown>
        records.set(facade, record as unknown as AnyRecord)
        return { facade, record }
    }
    return { ctx, session }
}

describe('update state push', () => {
    it('shallow-merges a partial and returns true', async () => {
        const { ctx, session } = setup()
        const update = createUpdate(ctx)
        const { facade, record } = session({ count: 0, label: 'a' })
        expect(update({ count: 1 })(facade)).toBe(true)
        expect(record.sessionState.getSnapshot()).toEqual({ count: 1, label: 'a' })
    })

    it('applies an updater function over the previous snapshot', async () => {
        const { ctx, session } = setup()
        const update = createUpdate(ctx)
        const { facade, record } = session({ count: 1 })
        expect(update((prev: { count: number }) => ({ count: prev.count + 1 }))(facade)).toBe(true)
        expect(record.sessionState.getSnapshot()).toEqual({ count: 2 })
    })

    it('replaces nested objects wholesale (no deep merge)', async () => {
        const { ctx, session } = setup()
        const update = createUpdate(ctx)
        const { facade, record } = session({ nested: { a: 1, b: 2 } })
        expect(update({ nested: { a: 9 } } as Partial<{ nested: { a: number, b: number } }>)(facade)).toBe(true)
        expect(record.sessionState.getSnapshot()).toEqual({ nested: { a: 9 } })
    })

    it('returns false and never invokes the updater once poisoned (disposed silent no-op)', async () => {
        const { ctx, session } = setup()
        const update = createUpdate(ctx)
        const { facade, record } = session({ count: 0 })
        record.sessionState.poison()
        let invoked = false
        expect(update(() => {
            invoked = true
            return { count: 1 }
        })(facade)).toBe(false)
        expect(invoked).toBe(false)
        expect(record.sessionState.getSnapshot()).toEqual({ count: 0 })
    })

    it('returns false for an unknown session handle (treated as dead)', async () => {
        const { ctx } = setup()
        const update = createUpdate(ctx)
        const stranger = { state$: null } as unknown as Session<{ count: number }, unknown>
        expect(update({ count: 1 })(stranger)).toBe(false)
    })
})
