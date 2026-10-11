/**
 * Blueprint seed: creates the immutable starting declaration of a context.
 *
 * This module is pure: no DOM access, no timers, no I/O. It runs in a plain
 * Node environment.
 */
import type { ContextBlueprint } from '../../domain/model/blueprint.js'

/**
 * Creates a blueprint seed from an initial state object. Phase 1 of the
 * two-phase model: a pure, lazy, in-memory declaration with zero DOM access,
 * zero I/O, zero listeners, and zero factory execution. Every call returns a
 * new blueprint; the call is idempotent and the input is never mutated.
 *
 * @param initial Seed state stored as-is by reference (no copy, no
 * deep freeze); later hydration or `update` may supersede it at mount.
 * @returns A new blueprint with the given initial, an empty provider map, no
 * hooks, and null storage.
 * @example
 * ```ts
 * import { createContext } from './create-context.js'
 *
 * const blueprint = createContext({ count: 0 })
 * console.log(blueprint.initial)
 * ```
 */
export function createContext<S extends Record<PropertyKey, unknown>>(initial: S): ContextBlueprint<S> {
    return {
        initial,
        providers: new Map(),
        hooks: [],
        storage: null,
    }
}
