import type {
    IContextBlueprint,
    IServiceRegistration,
    ISession,
    ServiceLifecycle,
    ServiceToken
} from './types'

export interface IWithProviderOptions {
    readonly lifecycle?: ServiceLifecycle | undefined
    readonly multi?: boolean | undefined
}

/**
 * Pure blueprint operator to register a synchronous service provider.
 *
 * @param token Service identifier (string or branded ServiceToken).
 * @param factory Factory function to instantiate the service.
 * @param options Lifecycle and collection configuration options.
 * @returns A higher-order blueprint transformer function.
 */
export function withProvider<
    K extends string | ServiceToken<any>,
    T,
    S extends Record<PropertyKey, any>,
    ExistingServices
>(
    token: K,
    factory: (session: ISession<S, ExistingServices>) => T,
    options?: IWithProviderOptions
): (
    blueprint: IContextBlueprint<S, ExistingServices>
) => IContextBlueprint<
    S,
    ExistingServices &
        (K extends ServiceToken<infer R>
            ? Record<K['name'], R>
            : K extends string
              ? Record<K, T>
              : {})
> {
    return (blueprint) => {
        const nextProviders = new Map(blueprint.providers)
        const registration: IServiceRegistration<T> = {
            token,
            factory: factory as (session: ISession<any, any>) => T,
            lifecycle: options?.lifecycle ?? 'scoped',
            isAsync: false,
            multi: options?.multi ?? false
        }

        nextProviders.set(token, registration)

        return {
            ...blueprint,
            providers: nextProviders
        }
    }
}
