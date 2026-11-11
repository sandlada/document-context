/**
 * Injection lifecycles.
 *
 * Three caching behaviours exist: `scoped` (one instance per session), `singleton` (one instance
 * per application, first registration wins) and `transient` / `prototype` (a new instance on every
 * injection).
 */

import type { ProviderLifecycle, ProviderRegistration } from '../../domain/model/blueprint'
import type { TokenLike } from '../../domain/model/token'
import type { ApplicationRuntime, CacheSlot, ProviderCacheKey } from '../context'
import type { SessionRuntime } from '../session'

/**
 * The cache key of a registration.
 *
 * @param registration - The registration.
 * @returns The registration itself for multi registrations, the token otherwise.
 */
export function cacheKey(registration: {
    readonly token: TokenLike
    readonly multi: boolean
}): ProviderCacheKey {
    return registration.multi ? (registration as ProviderCacheKey) : registration.token
}

/**
 * The cache that holds the instances of a lifecycle.
 *
 * @param runtime - The application runtime.
 * @param session - The session the value belongs to.
 * @param lifecycle - The lifecycle of the registration.
 * @returns The cache map.
 */
export function cacheFor(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
    lifecycle: ProviderLifecycle,
): Map<ProviderCacheKey, CacheSlot> {
    return lifecycle === 'singleton' ? runtime.singletons : session.scopedCache
}

/**
 * Claim the registration right of a singleton token.
 *
 * The first session that registers a singleton token owns it. Later registrations of the same token
 * are ignored and reported as `SINGLETON_CONFLICT`.
 *
 * @param runtime - The application runtime.
 * @param session - The session that wants to register the token.
 * @param token - The singleton token.
 * @returns `true` when the claim succeeded, `false` when the token is already owned.
 */
export function claimSingleton(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
    registration: ProviderRegistration,
): boolean {
    const token = registration.token
    if (runtime.singletonOwners.has(token)) {
        return false
    }
    runtime.singletonOwners.set(token, session)
    runtime.singletonRegistrations.set(token, registration)
    return true
}

/**
 * Whether a singleton registration is the one allowed to produce the value.
 *
 * @param runtime - The application runtime.
 * @param registration - The registration to test.
 * @returns `false` when an earlier singleton registration owns the token.
 */
export function isWinningSingleton(
    runtime: ApplicationRuntime,
    registration: ProviderRegistration,
): boolean {
    if (registration.lifecycle !== 'singleton') {
        return true
    }
    const winner = runtime.singletonRegistrations.get(registration.token)
    return winner === undefined || winner === registration
}

/**
 * Release the registration right of a singleton token.
 *
 * @param runtime - The application runtime.
 * @param session - The session that owned the token.
 */
export function releaseSingletons(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
): void {
    for (const [token, owner] of runtime.singletonOwners) {
        if (owner !== session) {
            continue
        }
        runtime.singletonOwners.delete(token)
        runtime.singletonRegistrations.delete(token)
        runtime.singletons.delete(token)
    }
    for (const registration of session.blueprint.providers) {
        if (registration.lifecycle === 'singleton') {
            runtime.singletons.delete(registration)
        }
    }
}
