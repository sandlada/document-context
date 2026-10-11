import { describe, expect, it } from 'vitest'
import { createSessionState } from '../../domain/index.js'
import type { MountSessionRecord, Session } from '../../domain/index.js'
import { createSelection } from './select.js'
import type { SelectionContext } from './select.js'

type AnySession = Session<Record<PropertyKey, unknown>, unknown>
type AnyRecord = MountSessionRecord<Record<PropertyKey, unknown>>

interface Setup {
    readonly ctx: SelectionContext
    readonly session: <S extends Record<PropertyKey, unknown>>(initial: S) => {
        readonly facade: Session<S, unknown>
        readonly record: MountSessionRecord<S>
    }
}

const setup = (): Setup => {
    const records = new WeakMap<object, AnyRecord>()
    const ctx: SelectionContext = { records }
    const session = <S extends Record<PropertyKey, unknown>>(initial: S): {
        readonly facade: Session<S, unknown>
        readonly record: MountSessionRecord<S>
    } => {
        const store = createSessionState<S>({ ...initial })
        const record = {
            kind: 'anonymous',
            token: null,
            host: null,
            status: 'mounted',
            sessionState: store,
            services: null,
            abortController: new AbortController(),
            abort$: store.state$.pipe(),
            onMountSkipped: false,
            createdAt: 0,
            scheduler: null,
        } as unknown as MountSessionRecord<S>
        const facade = { state$: store.state$, host: null } as unknown as Session<S, unknown>
        records.set(facade, record as unknown as AnyRecord)
        return { facade, record }
    }
    return { ctx, session }
}

describe('select$ stream projection', () => {
    it('maps every state emission without filtering (no distinctUntilChanged)', async () => {
        const { ctx, session } = setup()
        const { select$ } = createSelection(ctx)
        const { facade, record } = session({ count: 0 })
        const seen: Array<number> = []
        const subscription = select$((state: { count: number }) => state.count)(facade).subscribe((value) => {
            seen.push(value)
        })
        record.sessionState.update({ count: 0 })
        record.sessionState.update({ count: 1 })
        record.sessionState.update({ count: 1 })
        expect(seen).toEqual([0, 0, 1, 1])
        subscription.unsubscribe()
    })

    it('delivers the current snapshot immediately to late subscribers', async () => {
        const { ctx, session } = setup()
        const { select$ } = createSelection(ctx)
        const { facade, record } = session({ count: 5 })
        record.sessionState.update({ count: 6 })
        const seen: Array<number> = []
        const subscription = select$((state: { count: number }) => state.count)(facade).subscribe((value) => {
            seen.push(value)
        })
        expect(seen).toEqual([6])
        subscription.unsubscribe()
    })

    it('throws DISPOSED_SESSION for an unknown session handle', async () => {
        const { ctx } = setup()
        const { select$ } = createSelection(ctx)
        const stranger = { state$: null } as unknown as AnySession
        expect(() => select$((state: Record<PropertyKey, unknown>) => state)(stranger)).toThrowError(
            expect.objectContaining({ code: 'DISPOSED_SESSION' }),
        )
    })

    it('completes immediately for a disposed session without throwing', async () => {
        const { ctx, session } = setup()
        const { select$ } = createSelection(ctx)
        const { facade, record } = session({ count: 1 })
        record.sessionState.poison()
        const seen: Array<number> = []
        let completed = false
        const subscription = select$((state: { count: number }) => state.count)(facade).subscribe({
            next: (value) => {
                seen.push(value)
            },
            complete: () => {
                completed = true
            },
        })
        expect(seen).toEqual([])
        expect(completed).toBe(true)
        subscription.unsubscribe()
    })
})

describe('selectSync memoised snapshot', () => {
    it('returns the projection of the current snapshot', async () => {
        const { ctx, session } = setup()
        const { selectSync } = createSelection(ctx)
        const { facade } = session({ count: 3 })
        expect(selectSync((state: { count: number }) => state.count * 2)(facade)).toBe(6)
    })

    it('caches the last (state, result) pair: same snapshot never recomputes', async () => {
        const { ctx, session } = setup()
        const { selectSync } = createSelection(ctx)
        const { facade } = session({ count: 3 })
        let calls = 0
        const read = selectSync((state: { count: number }) => {
            calls += 1
            return state.count
        })
        expect(read(facade)).toBe(3)
        expect(read(facade)).toBe(3)
        expect(calls).toBe(1)
    })

    it('invalidates the cache after an update', async () => {
        const { ctx, session } = setup()
        const { selectSync } = createSelection(ctx)
        const { facade, record } = session({ count: 3 })
        let calls = 0
        const read = selectSync((state: { count: number }) => {
            calls += 1
            return state.count
        })
        expect(read(facade)).toBe(3)
        record.sessionState.update({ count: 4 })
        expect(read(facade)).toBe(4)
        expect(calls).toBe(2)
    })

    it('returns the last snapshot for a poisoned store', async () => {
        const { ctx, session } = setup()
        const { selectSync } = createSelection(ctx)
        const { facade, record } = session({ count: 9 })
        record.sessionState.poison()
        expect(selectSync((state: { count: number }) => state.count)(facade)).toBe(9)
    })

    it('throws DISPOSED_SESSION for an unknown session handle', async () => {
        const { ctx } = setup()
        const { selectSync } = createSelection(ctx)
        const stranger = { state$: null } as unknown as AnySession
        expect(() => selectSync((state: Record<PropertyKey, unknown>) => state)(stranger)).toThrowError(
            expect.objectContaining({ code: 'DISPOSED_SESSION' }),
        )
    })
})
