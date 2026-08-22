import type { IContextBlueprint, IStorageOptions } from '../core/types'

/**
 * Pure blueprint operator to register state persistence and hydration options.
 *
 * @param options Storage configuration options.
 * @returns A higher-order blueprint transformer function.
 */
export function withStorage<S extends Record<PropertyKey, any> = Record<PropertyKey, any>, Services = {}>(
    options: IStorageOptions<S>
): <ActualState extends S, ActualServices extends Services>(
    blueprint: IContextBlueprint<ActualState, ActualServices>
) => IContextBlueprint<ActualState, ActualServices> {
    return (blueprint) => ({
        ...blueprint,
        storage: options as IStorageOptions<any>
    })
}
