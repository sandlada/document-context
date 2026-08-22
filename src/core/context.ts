import { isDev } from './session-internal'
import type { IContextBlueprint } from './types'

/**
 * Creates a pure immutable blueprint seed for a context container.
 *
 * @param initialState The initial state data snapshot.
 * @returns A pure IContextBlueprint instance with zero DOM side effects.
 */
export function createContext<S extends Record<PropertyKey, any>>(
    initialState: S
): IContextBlueprint<S, {}> {
    const frozenState = isDev() ? Object.freeze({ ...initialState }) : initialState

    return {
        initialState: frozenState,
        providers: new Map(),
        bridges: [],
        storage: undefined,
        hooks: []
    }
}
