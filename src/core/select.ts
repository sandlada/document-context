import { getInternalSession, isDev } from './session-internal'
import type { ISession } from './types'

/**
 * Curried synchronous state snapshot reader.
 *
 * @param selector Pure function to project or select a slice of state.
 * @returns Curried function accepting the ISession.
 */
export function select<S extends Record<PropertyKey, any>, R>(
    selector: (state: S) => R
): <Services>(session: ISession<S, Services>) => R {
    return <Services>(session: ISession<S, Services>) => {
        const internal = getInternalSession(session)
        const currentState = internal ? internal.stateSubject.getValue() : session.blueprint.initialState
        const selected = selector(currentState)

        if (
            isDev() &&
            selected !== null &&
            typeof selected === 'object' &&
            !Object.isFrozen(selected)
        ) {
            return Object.freeze(selected) as R
        }

        return selected
    }
}
