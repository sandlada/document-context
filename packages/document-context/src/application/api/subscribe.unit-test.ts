import { Subject } from 'rxjs'
import { describe, expect, it } from 'vitest'
import { createSessionState } from '../../domain/index.js'
import type { MountSessionRecord, Session } from '../../domain/index.js'
import { createSubscribe } from './subscribe.js'
import type { SubscribeContext } from './subscribe.js'

type AnySession = Session<Record<PropertyKey, unknown>, unknown>
type AnyRecord = MountSessionRecord<Record<PropertyKey, unknown>>

const setup = (): {
    readonly ctx: SubscribeContext
    readonly records: WeakMap<object, AnyRecord>
    readonly session: <S extends Record<PropertyKey, unknown>>(initial: S) => {
        readonly facade: Session<S, unknown>
        readonly record: MountSessionRecord<S>
    }
} => {
    const records = new WeakMap<object, AnyRecord>()
    const ctx: SubscribeContext = { records }
    const session = <S extends Record<PropertyKey, unknown>>(initial: S): {
        readonly facade: Session<S, unknown>
        readonly record: MountSessionRecord<S>
    } => {
        const store = createSessionState<S>({ ...initial })
        const record = {
            status: 'mounted',
            sessionState: store,
            abortController: new AbortController(),
            abort$: new Subject<void>().asObservable(),
        } as unknown as MountSessionRecord<S>
        const facade = { state$: store.state$ } as unknown as Session<S, unknown>
        records.set(facade, record as unknown as AnyRecord)
        return { facade, record }
    }
    return { ctx, records, session }
}

describe('subscribe$ listener fan-out', () => {
    it('delivers the current snapshot immediately, then every update', async () => {
        const { ctx, session } = setup()
        const subscribe$ = createSubscribe(ctx)
        const { facade, record } = session({ count: 0 })
        const seen: Array<{ count: number }> = []
        const subscription = subscribe$((state: { count: number }) => {
            seen.push({ ...state })
        })(facade)
        record.sessionState.update({ count: 1 })
        record.sessionState.update({ count: 2 })
        expect(seen).toEqual([{ count: 0 }, { count: 1 }, { count: 2 }])
        subscription.unsubscribe()
    })

    it('returns a Subscription that stops delivery on unsubscribe', async () => {
        const { ctx, session } = setup()
        const subscribe$ = createSubscribe(ctx)
        const { facade, record } = session({ count: 0 })
        const seen: Array<number> = []
        const subscription = subscribe$((state: { count: number }) => {
            seen.push(state.count)
        })(facade)
        subscription.unsubscribe()
        expect(subscription.closed).toBe(true)
        record.sessionState.update({ count: 1 })
        expect(seen).toEqual([0])
    })

    it('returns an immediately-completed empty stream for a disposed session', async () => {
        const { ctx, session } = setup()
        const subscribe$ = createSubscribe(ctx)
        const { facade, record } = session({ count: 0 })
        record.sessionState.poison()
        const disposed = {
            ...record,
            status: 'disposed',
        } as unknown as AnyRecord
        ctx.records.set(facade, disposed)
        const seen: Array<number> = []
        const subscription = subscribe$((state: { count: number }) => {
            seen.push(state.count)
        })(facade)
        expect(seen).toEqual([])
        expect(subscription.closed).toBe(true)
    })

    it('throws DISPOSED_SESSION for an unknown session handle', async () => {
        const { ctx } = setup()
        const subscribe$ = createSubscribe(ctx)
        const stranger = { state$: null } as unknown as AnySession
        expect(() => subscribe$((state: Record<PropertyKey, unknown>) => {
            void state
        })(stranger)).toThrowError(expect.objectContaining({ code: 'DISPOSED_SESSION' }))
    })
})
