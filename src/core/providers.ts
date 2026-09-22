import type {
    IContextBlueprint,
    IServiceRegistration,
    ISession,
    ServiceLifecycle,
    ServiceToken
} from './types'

/**
 * Options for {@link withProvider} / {@link withAsyncProvider}.
 *
 * @property lifecycle - Caching policy, defaulting to `'scoped'`. See
 * {@link ServiceLifecycle}: `'singleton'` shares one instance page-wide,
 * `'scoped'` caches one instance per session, `'transient'` creates a fresh
 * instance per injection.
 * @property multi - When `true`, the registration participates in
 * `injectAll()` accumulation. Defaults to `false` (first-match wins).
 */
export interface IWithProviderOptions {
    readonly lifecycle?: ServiceLifecycle | undefined
    readonly multi?: boolean | undefined
}

/**
 * Pure Phase 1 operator that registers a synchronous service provider.
 *
 * Clones the blueprint with structural sharing and adds (or replaces) the
 * entry in `providers`. The factory runs lazily on first `inject()` and
 * receives the owning session, so it may itself call `inject()` / `select()`.
 * Recursive re-entry of the same token throws `CircularDependencyError`.
 * String tokens are typed via the `ServiceRegistry` augmentation; branded
 * `ServiceToken` arguments infer their value type from the token.
 *
 * @param token - Service identifier: a string key or a branded
 * `ServiceToken`. Must be unique within the blueprint; re-registering the
 * same token replaces the previous entry.
 * @param factory - `(session) => instance` instantiation function.
 * @param options - Lifecycle and multi-collection flags; see
 * {@link IWithProviderOptions}.
 * @returns A blueprint transformer that extends the service-type accumulator
 * with `Record<TokenName, T>`.
 *
 * @example
 * ```ts
 * import { createContext, pipe, withProvider, mount, inject } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     createContext({ count: 0 }),
 *     withProvider('logger', () => new ConsoleLogger(), { lifecycle: 'singleton' })
 * )
 * const session = mount(blueprint)(document.getElementById('app')!)
 * const logger = inject('logger')(session)
 * ```
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
