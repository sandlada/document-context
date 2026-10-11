/**
 * Subscription verb: fan-out of the hot session state stream to a listener,
 * converging on session disposal. Suspended sessions keep pushing (caller
 * owns backpressure and visibility).
 *
 * Phase: runtime (application layer). The factory is pure: calling
 * `createSubscribe` performs no I/O and subscribes to nothing. The verb
 * subscribes to the session store piped through `takeUntil(abort$)` so every
 * internal subscription converges on disposal. Side effects: subscription
 * management only. Idempotency: subscribing twice yields independent
 * subscriptions. Lifecycle: disposed sessions yield an immediately-completed
 * empty stream; unknown handles throw `DISPOSED_SESSION`.
 */

import { EMPTY, takeUntil } from 'rxjs'
import type { Subscription } from 'rxjs'
import { DocumentContextError } from '../../domain/index.js'
import type { MountSessionRecord, Session } from '../../domain/index.js'

/**
 * Structural application context consumed by subscribe: the
 * facade-to-record lookup only. Mirrors the frozen `ApplicationContext`
 * subset this track needs; `../context.js` (parallel track) is intentionally
 * not imported so this module typechecks standalone.
 */
export interface SubscribeContext {
    /** Session facade to live record lookup. */
    readonly records: WeakMap<object, MountSessionRecord<Record<PropertyKey, unknown>>>
}

/**
 * State subscription verb factory.
 *
 * Phase: runtime (first tier). Purity: subscribing never mutates state; the
 * listener observes snapshots. Side effects: one store subscription per call,
 * released on unsubscribe or disposal. Idempotency: each call subscribes
 * once. Lifecycle: the subscription ends on unsubscribe or on the session
 * `abort$`; suspended sessions keep pushing.
 */
export interface SubscribeFn {
    /**
     * Subscribes a listener to every session state snapshot.
     *
     * @param listener Callback invoked with the current snapshot immediately
     * and with each later snapshot.
     * @returns Data-last verb mapping a session to its `Subscription`.
     * @throws DocumentContextError with code `DISPOSED_SESSION` for unknown
     * session handles.
     * @example
     * ```ts
     * import { createSubscribe } from './subscribe.js'
     *
     * const subscribe$ = createSubscribe(ctx)
     * const subscription = subscribe$((state: { count: number }) => {
     *     console.log(state.count)
     * })(session)
     * subscription.unsubscribe()
     * ```
     */
    <S extends Record<PropertyKey, unknown>>(listener: (state: S) => void): (session: Session<S, unknown>) => Subscription
}

/**
 * Creates the subscription verb bound to one application context.
 *
 * Phase: pure factory; no DOM, no I/O, no listeners. Purity: creating the
 * verb never touches any session. Side effects: only the returned verb
 * subscribes, and only when called. Idempotency: creating twice yields
 * independent verbs over the same context. Lifecycle: records are observed
 * live per call.
 *
 * @param ctx Subscribe context owning the facade-to-record lookup.
 * @returns The `subscribe$` verb.
 * @example
 * ```ts
 * import { createSubscribe } from './subscribe.js'
 *
 * const subscribe$ = createSubscribe(ctx)
 * const subscription = subscribe$((state) => console.log(state))(session)
 * subscription.unsubscribe()
 * ```
 */
export const createSubscribe = (ctx: SubscribeContext): SubscribeFn => {
    const subscribe$ = (<S extends Record<PropertyKey, unknown>>(listener: (state: S) => void) =>
        (session: Session<S, unknown>): Subscription => {
            const record = ctx.records.get(session)
            if (record === undefined) {
                throw new DocumentContextError('DISPOSED_SESSION', {})
            }
            if (record.status === 'disposed') {
                return EMPTY.subscribe(listener as (value: never) => void)
            }
            return record.sessionState.state$
                .pipe(takeUntil(record.abort$))
                .subscribe((state) => listener(state as unknown as S))
        }) as SubscribeFn
    return subscribe$
}
