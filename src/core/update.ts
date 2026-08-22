import { getInternalSession, isDev } from './session-internal'
import type { ISession } from './types'

/**
 * Curried state updater verb.
 *
 * @param updater Partial state or updater transition function.
 * @returns Curried function accepting the ISession, returning boolean (false on disposed session No-op).
 */
export function update<S extends Record<PropertyKey, any>>(
    updater: Partial<S> | ((prevState: S) => Partial<S> | S)
): <Services>(session: ISession<S, Services>) => boolean {
    return <Services>(session: ISession<S, Services>): boolean => {
        if (session.isDisposed) {
            return false
        }

        const internal = getInternalSession(session)
        if (!internal || internal.isDisposed) {
            return false
        }

        const currentState = internal.stateSubject.getValue()
        const partialOrFull =
            typeof updater === 'function' ? updater(currentState) : updater

        const nextState = {
            ...currentState,
            ...partialOrFull
        }

        const finalState = isDev() ? Object.freeze(nextState) : nextState

        if (internal.isSuspended) {
            internal.dirtyQueue.push((_) => partialOrFull)
        }

        internal.stateSubject.next(finalState as S)
        return true
    }
}
