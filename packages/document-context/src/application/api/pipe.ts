/**
 * Blueprint composition: folds operators left to right over a seed blueprint.
 *
 * This module is pure: no DOM access, no timers, no I/O. It runs in a plain
 * Node environment.
 */
import type { ContextBlueprint } from '../../domain/model/blueprint.js'

/**
 * A pure blueprint transformer: takes a blueprint and returns a new one,
 * never mutating its input. Unchanged slices are shared by reference
 * (structural sharing); factories and hook handlers are never executed here.
 *
 * @param S State shape carried by the blueprint.
 * @param bp Input blueprint to transform.
 * @returns A new blueprint.
 */
export type BlueprintOperator<S extends Record<PropertyKey, unknown>> = (bp: ContextBlueprint<S>) => ContextBlueprint<S>

/**
 * Composes a seed blueprint with operators left to right. Phase 1 of the
 * two-phase model: a pure, lazy, in-memory fold with zero DOM access, zero
 * I/O, zero listeners, and zero factory execution. With no operators the
 * input is returned unchanged; otherwise the final operator output is
 * returned. The call is idempotent and no input is ever mutated.
 *
 * @param bp Seed blueprint, usually from `createContext`.
 * @param operators Blueprint operators applied in order; each receives the
 * previous output.
 * @returns The final blueprint.
 * @example
 * ```ts
 * import { createContext } from './create-context.js'
 * import { pipe } from './pipe.js'
 * import type { ContextBlueprint } from '../../domain/model/blueprint.js'
 *
 * const keep = (bp: ContextBlueprint<{ count: number }>): ContextBlueprint<{ count: number }> => ({ ...bp })
 * const blueprint = pipe(createContext({ count: 0 }), keep)
 * console.log(blueprint.initial)
 * ```
 */
export function pipe<S extends Record<PropertyKey, unknown>>(
    bp: ContextBlueprint<S>,
    ...operators: ReadonlyArray<BlueprintOperator<S>>
): ContextBlueprint<S> {
    return operators.reduce((accumulated, operator) => operator(accumulated), bp)
}
