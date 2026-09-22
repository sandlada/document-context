import { getInternalSession } from './session-internal'
import type { ISession } from './types'

/**
 * Subscribes a listener to reactive state changes in Data-Last form
 * `subscribe(listener)(session)`.
 *
 * Backed by the session `BehaviorSubject`, so the listener fires immediately
 * with the current state and again on every subsequent `update()`, bridge
 * write, storage hydration, or resuscitation flush. The returned function
 * unsubscribes exactly that listener; call it during `dispose` cleanups to
 * avoid leaks.
 *
 * Disposed sessions yield a no-op unsubscribe without invoking the listener,
 * matching the `update()` silent-no-op contract.
 *
 * @param listener - Callback receiving each state snapshot `(state) => void`.
 * Must not mutate the snapshot (it is frozen in development).
 * @returns A curried function accepting an `ISession` and returning a
 * zero-argument unsubscribe cleanup.
 *
 * @example
 * ```ts
 * import { subscribe } from '@sandlada/document-context'
 *
 * const unsubscribe = subscribe((s: { count: number }) => {
 *     console.log('count is', s.count)
 * })(session)
 * unsubscribe()
 * ```
 */
export function subscribe<S extends Record<PropertyKey, any>>(
    listener: (state: S) => void
): <Services>(session: ISession<S, Services>) => () => void {
    return <Services>(session: ISession<S, Services>) => {
        if (session.isDisposed) {
            return () => {}
        }

        const internal = getInternalSession(session)
        if (!internal || internal.isDisposed) {
            return () => {}
        }

        const subscription = internal.stateSubject.subscribe(listener)
        return () => subscription.unsubscribe()
    }
}
