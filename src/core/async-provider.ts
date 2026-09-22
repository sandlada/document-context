import type {
    IContextBlueprint,
    IServiceRegistration,
    ISession,
    ServiceLifecycle,
    ServiceToken
} from './types'

/**
 * Options for {@link withAsyncProvider}.
 *
 * @property lifecycle - Caching policy, defaulting to `'scoped'`. Resolved
 * async values are cached the same way as sync ones (`'singleton'` lands in
 * the global registry, `'scoped'` on the session, `'transient'` is never
 * cached).
 * @property multi - When `true`, the registration participates in
 * `injectAllAsync()` accumulation. Defaults to `false`.
 */
export interface IWithAsyncProviderOptions {
    readonly lifecycle?: ServiceLifecycle | undefined
    readonly multi?: boolean | undefined
}

/**
 * Pure Phase 1 operator that registers an asynchronous service provider.
 *
 * Identical to `withProvider` except the factory returns a `Promise<T>`.
 * In-flight promises are coalesced per token and evicted immediately on
 * rejection, so concurrent `injectAsync()` callers share one attempt and a
 * failure self-heals for the next retry. The service type accumulates as
 * `Promise<T>`; synchronous `inject()` against this token throws
 * `AsyncServiceNotReadyError` and callers must use `injectAsync()`.
 *
 * @param token - Service identifier: a string key or a branded
 * `ServiceToken`. Re-registering replaces the previous entry.
 * @param asyncFactory - `(session) => Promise<instance>` factory.
 * @param options - Lifecycle and multi-collection flags; see
 * {@link IWithAsyncProviderOptions}.
 * @returns A blueprint transformer extending services with
 * `Record<TokenName, Promise<T>>`.
 *
 * @example
 * ```ts
 * import { createContext, pipe, withAsyncProvider, mountAsync, injectAsync } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     createContext({ count: 0 }),
 *     withAsyncProvider('remote-config', async () => fetch('/config.json').then((r) => r.json()))
 * )
 * const session = await mountAsync(blueprint)(document.getElementById('app')!)
 * const config = await injectAsync('remote-config')(session)
 * ```
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
