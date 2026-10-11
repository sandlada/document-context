/**
 * Synchronous resolution kernel: single-fetch projection plus multi-fetch
 * collection over an injected service store, with a thin transport passthrough.
 *
 * This module is pure: no DOM access, no timers, no I/O. It runs in a plain
 * Node environment. Sync re-entry of the same token surfaces as
 * `CIRCULAR_DEPENDENCY` through the injected service registry guard; async
 * re-entry never reaches this module (async paths coalesce per the service
 * machine, so this module stays sync-only by construction).
 *
 * Rules enforced here (domain-enforceable kernel):
 * - disposed sessions reject every sync fetch with `DISPOSED_SESSION`;
 * - single and multi registrations may coexist under one token; single-fetch
 *   prefers the single registration, and multi-only tokens fail single-fetch
 *   with `UNKNOWN_SERVICE`;
 * - sync paths touching an async (promise) value fail the whole fetch with
 *   `ASYNC_SERVICE_NOT_READY` (multi-fetch never partially skips);
 * - missing tokens fail with `UNKNOWN_SERVICE`.
 *
 * Deferred to the application layer: token-string validation (`TOKEN_INVALID`
 * via the shared validator), `Suspended` versus `Mounted` visibility, session$
 * tracking, `ServiceRegistry` versus `ServiceToken` versus bare-string overload
 * typing, and every async-first path (`inject` / `inject$` pending, timeouts,
 * cancellation, target death). Transport `request` integration beyond the
 * null-on-miss passthrough (direction, multi ordering) lives in the scope
 * model and the transport port.
 */

import { DocumentContextError } from '../model/errors.js'
import { isThenable } from '../ports/scope-transport.js'
import type { HostPort } from '../ports/host.js'
import type { ScopeResolution, ScopeTransportPort } from '../ports/scope-transport.js'
import type { ServiceRegistration, ServiceRegistryHandle } from '../model/service.js'
import type { Token } from '../model/token.js'

/**
 * Service store consumed by the sync kernel. `singles` holds the winning
 * single registration per token; `multis` accumulates `multi: true`
 * registrations per token; `registry` owns the sync re-entry guard;
 * `isDisposed` gates every fetch with `DISPOSED_SESSION`.
 */
export interface SyncServiceStore {
    /** Winning single registration per token. */
    readonly singles: ReadonlyMap<Token, ServiceRegistration>
    /** Accumulated multi registrations per token. */
    readonly multis: ReadonlyMap<Token, ReadonlyArray<ServiceRegistration>>
    /** Execution guard owning sync re-entry detection. */
    readonly registry: ServiceRegistryHandle
    /** True once the owning session reached terminal `disposed`. */
    readonly isDisposed: boolean
}

/**
 * Input for {@link resolveSync} and {@link resolveAllSync}.
 */
export interface ResolveSyncInput {
    /** Service store to resolve against. */
    readonly services: SyncServiceStore
    /** Token to resolve (string or private). */
    readonly token: Token
    /** Session passed through to the factory. */
    readonly session: unknown
}

/**
 * Resolves a single value synchronously: single registrations win over
 * coexisting multi registrations; multi-only or missing tokens throw
 * `UNKNOWN_SERVICE`; promise values and `async: true` registrations throw
 * `ASYNC_SERVICE_NOT_READY`; same-token sync re-entry throws
 * `CIRCULAR_DEPENDENCY` via the registry guard.
 *
 * @param input Store, token, and session.
 * @returns The factory value.
 * @throws DocumentContextError with code `DISPOSED_SESSION`, `UNKNOWN_SERVICE`,
 * `ASYNC_SERVICE_NOT_READY`, or `CIRCULAR_DEPENDENCY`.
 * @example
 * ```ts
 * import { resolveSync } from './resolve.js'
 *
 * const value = resolveSync({ services, token: 'app:user', session })
 * ```
 */
export function resolveSync(input: ResolveSyncInput): unknown {
    const { services, token, session } = input
    if (services.isDisposed) {
        throw new DocumentContextError('DISPOSED_SESSION', {})
    }
    const single = services.singles.get(token)
    if (single === undefined) {
        throw new DocumentContextError('UNKNOWN_SERVICE', { token })
    }
    return services.registry.resolveSync(token, () => {
        const produced = single.factory(session)
        if (single.async || isThenable(produced)) {
            throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', {})
        }
        return produced
    })
}

/**
 * Collects multi registrations synchronously in registration order. An empty
 * snapshot is legal (sync snapshots describe the current moment, unlike async
 * first-non-empty waits). Any unready (promise or `async: true`) entry fails
 * the whole fetch with `ASYNC_SERVICE_NOT_READY`; entries are never partially
 * skipped.
 *
 * @param input Store, token, and session.
 * @returns Ordered values, possibly empty.
 * @throws DocumentContextError with code `DISPOSED_SESSION` or
 * `ASYNC_SERVICE_NOT_READY`.
 * @example
 * ```ts
 * import { resolveAllSync } from './resolve.js'
 *
 * const tags = resolveAllSync({ services, token: 'app:tag', session })
 * ```
 */
export function resolveAllSync(input: ResolveSyncInput): Array<unknown> {
    const { services, token, session } = input
    if (services.isDisposed) {
        throw new DocumentContextError('DISPOSED_SESSION', {})
    }
    const entries = services.multis.get(token) ?? []
    const values: Array<unknown> = []
    for (const registration of entries) {
        const produced = services.registry.resolveSync(token, () => registration.factory(session)) as unknown
        if (registration.async || isThenable(produced)) {
            throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', {})
        }
        values.push(produced)
    }
    return values
}

/**
 * Thin null-on-miss passthrough to `transport.request`: returns the nearest
 * hit or null without waiting. Single-value resolution is always
 * nearest-wins with no direction.
 *
 * @param transport Scope transport resolving along `HostPort.parent` chains.
 * @param token Token to resolve (string or private).
 * @param from Host starting the ancestor walk.
 * @returns The nearest resolution, or null when nothing matches.
 * @example
 * ```ts
 * import { resolveViaTransport } from './resolve.js'
 *
 * const hit = resolveViaTransport(transport, 'app:theme', leaf)
 * ```
 */
export function resolveViaTransport<T>(
    transport: ScopeTransportPort,
    token: Token,
    from: HostPort,
): ScopeResolution<T> | null {
    return transport.request<T>(token, from)
}
