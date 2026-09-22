import type { IContextBlueprint } from './types'

/**
 * Operator that transforms one blueprint into another while preserving the
 * state shape `S` and threading the service-type accumulator
 * (`InServices` to `OutServices`).
 *
 * Every `with*` operator returns this shape, so `pipe` can chain them with
 * full type inference. Operators must stay pure: clone-and-return, never
 * mutate the input blueprint.
 *
 * @example
 * ```ts
 * import { withProvider } from '@sandlada/document-context'
 *
 * const addLogger = withProvider('logger', () => new ConsoleLogger())
 * ```
 */
export type BlueprintOperator<S extends Record<PropertyKey, any>, InServices, OutServices> = (
    blueprint: IContextBlueprint<S, InServices>
) => IContextBlueprint<S, OutServices>

export function pipe<S extends Record<PropertyKey, any>, S0>(
    source: IContextBlueprint<S, S0>
): IContextBlueprint<S, S0>

export function pipe<S extends Record<PropertyKey, any>, S0, S1>(
    source: IContextBlueprint<S, S0>,
    op1: BlueprintOperator<S, S0, S1>
): IContextBlueprint<S, S1>

export function pipe<S extends Record<PropertyKey, any>, S0, S1, S2>(
    source: IContextBlueprint<S, S0>,
    op1: BlueprintOperator<S, S0, S1>,
    op2: BlueprintOperator<S, S1, S2>
): IContextBlueprint<S, S2>

export function pipe<S extends Record<PropertyKey, any>, S0, S1, S2, S3>(
    source: IContextBlueprint<S, S0>,
    op1: BlueprintOperator<S, S0, S1>,
    op2: BlueprintOperator<S, S1, S2>,
    op3: BlueprintOperator<S, S2, S3>
): IContextBlueprint<S, S3>

export function pipe<S extends Record<PropertyKey, any>, S0, S1, S2, S3, S4>(
    source: IContextBlueprint<S, S0>,
    op1: BlueprintOperator<S, S0, S1>,
    op2: BlueprintOperator<S, S1, S2>,
    op3: BlueprintOperator<S, S2, S3>,
    op4: BlueprintOperator<S, S3, S4>
): IContextBlueprint<S, S4>

export function pipe<S extends Record<PropertyKey, any>, S0, S1, S2, S3, S4, S5>(
    source: IContextBlueprint<S, S0>,
    op1: BlueprintOperator<S, S0, S1>,
    op2: BlueprintOperator<S, S1, S2>,
    op3: BlueprintOperator<S, S2, S3>,
    op4: BlueprintOperator<S, S3, S4>,
    op5: BlueprintOperator<S, S4, S5>
): IContextBlueprint<S, S5>

export function pipe<S extends Record<PropertyKey, any>, S0, S1, S2, S3, S4, S5, S6>(
    source: IContextBlueprint<S, S0>,
    op1: BlueprintOperator<S, S0, S1>,
    op2: BlueprintOperator<S, S1, S2>,
    op3: BlueprintOperator<S, S2, S3>,
    op4: BlueprintOperator<S, S3, S4>,
    op5: BlueprintOperator<S, S4, S5>,
    op6: BlueprintOperator<S, S5, S6>
): IContextBlueprint<S, S6>

export function pipe<S extends Record<PropertyKey, any>, S0, S1, S2, S3, S4, S5, S6, S7>(
    source: IContextBlueprint<S, S0>,
    op1: BlueprintOperator<S, S0, S1>,
    op2: BlueprintOperator<S, S1, S2>,
    op3: BlueprintOperator<S, S2, S3>,
    op4: BlueprintOperator<S, S3, S4>,
    op5: BlueprintOperator<S, S4, S5>,
    op6: BlueprintOperator<S, S5, S6>,
    op7: BlueprintOperator<S, S6, S7>
): IContextBlueprint<S, S7>

export function pipe<S extends Record<PropertyKey, any>, S0, S1, S2, S3, S4, S5, S6, S7, S8>(
    source: IContextBlueprint<S, S0>,
    op1: BlueprintOperator<S, S0, S1>,
    op2: BlueprintOperator<S, S1, S2>,
    op3: BlueprintOperator<S, S2, S3>,
    op4: BlueprintOperator<S, S3, S4>,
    op5: BlueprintOperator<S, S4, S5>,
    op6: BlueprintOperator<S, S5, S6>,
    op7: BlueprintOperator<S, S6, S7>,
    op8: BlueprintOperator<S, S7, S8>
): IContextBlueprint<S, S8>

export function pipe<S extends Record<PropertyKey, any>, S0, S1, S2, S3, S4, S5, S6, S7, S8, S9>(
    source: IContextBlueprint<S, S0>,
    op1: BlueprintOperator<S, S0, S1>,
    op2: BlueprintOperator<S, S1, S2>,
    op3: BlueprintOperator<S, S2, S3>,
    op4: BlueprintOperator<S, S3, S4>,
    op5: BlueprintOperator<S, S4, S5>,
    op6: BlueprintOperator<S, S5, S6>,
    op7: BlueprintOperator<S, S6, S7>,
    op8: BlueprintOperator<S, S7, S8>,
    op9: BlueprintOperator<S, S8, S9>
): IContextBlueprint<S, S9>

export function pipe<S extends Record<PropertyKey, any>, S0, S1, S2, S3, S4, S5, S6, S7, S8, S9, S10>(
    source: IContextBlueprint<S, S0>,
    op1: BlueprintOperator<S, S0, S1>,
    op2: BlueprintOperator<S, S1, S2>,
    op3: BlueprintOperator<S, S2, S3>,
    op4: BlueprintOperator<S, S3, S4>,
    op5: BlueprintOperator<S, S4, S5>,
    op6: BlueprintOperator<S, S5, S6>,
    op7: BlueprintOperator<S, S6, S7>,
    op8: BlueprintOperator<S, S7, S8>,
    op9: BlueprintOperator<S, S8, S9>,
    op10: BlueprintOperator<S, S9, S10>
): IContextBlueprint<S, S10>

/**
 * Composes blueprint operators left-to-right into a single immutable blueprint.
 *
 * Pure Phase 1 composition: no DOM access, no I/O, no listeners. Each operator
 * receives the blueprint returned by the previous one, so service types
 * accumulate (`S0` through `S10`) with full inference. Calling `pipe(source)`
 * with no operators returns `source` unchanged.
 *
 * Overloads cover chains of up to ten operators with precise typing; longer
 * chains fall through to the variadic implementation signature.
 *
 * @param source - Seed blueprint, typically from `createContext()`.
 * @param operators - `BlueprintOperator` functions applied in order
 * (`op1`, then `op2`, and so on).
 * @returns The composed `IContextBlueprint` carrying the union of all
 * registered services.
 *
 * @example
 * ```ts
 * import { createContext, pipe, withProvider, withBridge, withStorage } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     createContext({ count: 0 }),
 *     withProvider('logger', () => new ConsoleLogger()),
 *     withBridge({ properties: { count: 'dataset.count' } }),
 *     withStorage({ adapter: 'localStorage', key: 'counter' })
 * )
 * ```
 */
export function pipe<S extends Record<PropertyKey, any>>(
    source: IContextBlueprint<S, any>,
    ...operators: Array<(bp: IContextBlueprint<S, any>) => IContextBlueprint<S, any>>
): IContextBlueprint<S, any> {
    return operators.reduce((current, op) => op(current), source)
}
