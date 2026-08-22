import type {
    IContextBlueprint,
    IServiceRegistration,
    ISession,
    ServiceLifecycle,
    ServiceToken
} from './types'

export interface IWithAsyncProviderOptions {
    readonly lifecycle?: ServiceLifecycle | undefined
    readonly multi?: boolean | undefined
}

/**
 * Pure blueprint operator to register an asynchronous service provider.
 *
 * @param token Service identifier (string or branded ServiceToken).
 * @param asyncFactory Asynchronous factory returning a Promise.
 * @param options Lifecycle and collection configuration options.
 * @returns A higher-order blueprint transformer function.
 */
export function withAsyncProvider<
    K extends string | ServiceToken<any>,
    T,
    S extends Record<PropertyKey, any>,
    ExistingServices
>(
    token: K,
    asyncFactory: (session: ISession<S, ExistingServices>) => Promise<T>,
    options?: IWithAsyncProviderOptions
): (
    blueprint: IContextBlueprint<S, ExistingServices>
) => IContextBlueprint<
    S,
    ExistingServices &
        (K extends ServiceToken<infer R>
            ? Record<K['name'], Promise<R>>
            : K extends string
              ? Record<K, Promise<T>>
              : {})
> {
    return (blueprint) => {
        const nextProviders = new Map(blueprint.providers)
        const registration: IServiceRegistration<Promise<T>> = {
            token,
            factory: asyncFactory as (session: ISession<any, any>) => Promise<T>,
            lifecycle: options?.lifecycle ?? 'scoped',
            isAsync: true,
            multi: options?.multi ?? false
        }

        nextProviders.set(token, registration)

        return {
            ...blueprint,
            providers: nextProviders
        }
    }
}
