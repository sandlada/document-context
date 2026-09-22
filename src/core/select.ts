import { getInternalSession, isDev } from './session-internal'
import type { ISession } from './types'

/**
 * Curried synchronous snapshot reader in Data-Last form `select(selector)(session)`.
 *
 * Applies the pure `selector` projection to the current state value. When no
 * internal session exists (for example a bare blueprint seed), it falls back
 * to `session.blueprint.initialState`. In development, object results that are
 * not already frozen are shallow-frozen before returning, so downstream
 * mutation throws early instead of corrupting the store.
 *
 * The selector must stay pure: no DOM access, no I/O, no mutation of `state`.
 *
 * @param selector - Pure projection `(state) => slice`. May return any shape,
 * including primitives, objects, or derived values.
 * @returns A curried function accepting an `ISession` and returning the
 * selected slice `R`.
 *
 * @example
 * ```ts
 * import { select } from '@sandlada/document-context'
 *
 * const selectCount = select((s: { count: number }) => s.count)
 * const count = selectCount(session)
 * const selectDouble = select((s: { count: number }) => s.count * 2)
 * ```
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
