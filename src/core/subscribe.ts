import { getInternalSession } from './session-internal'
import type { ISession } from './types'

/**
 * Subscribes a listener to reactive state changes on a session.
 * Emits the current state immediately and subsequently on each state transition.
 *
 * @param listener Callback function receiving the current state.
 * @returns Curried function accepting the ISession, returning an unsubscribe cleanup function.
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
