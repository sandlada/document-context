import { getInternalSession, isDev } from './session-internal'
import type { ISession } from './types'

/**
 * Curried immutable state updater in Data-Last form `update(updater)(session)`.
 *
 * Accepts either a partial object (shallow-merged) or a transition function
 * `(prevState) => partial | full`. The next state is always a fresh object
 * (`{ ...current, ...partial }`, frozen in development) and is emitted through
 * the session `BehaviorSubject`, waking subscribers, bridges, and storage.
 *
 * Disposal and suspension contract: updates on a disposed session (or one
 * whose internals are gone) silently no-op and return `false`, so dangling
 * async closures cannot throw. Updates arriving while the session is suspended
 * (keyed host detached within its 50ms TTL) are additionally appended to the
 * dirty queue for replay on resuscitation, while still emitting to the live
 * subject.
 *
 * @param updater - Partial state object or transition function. Function form
 * receives the current state and returns the partial (or full) state to merge.
 * @returns A curried function accepting an `ISession` and returning `true`
 * when the transition was applied, `false` when skipped as a disposed no-op.
 *
 * @example
 * ```ts
 * import { update } from '@sandlada/document-context'
 *
 * const increment = update<{ count: number }>((s) => ({ count: s.count + 1 }))
 * increment(session)
 * update({ theme: 'dark' })(session)
 * ```
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
