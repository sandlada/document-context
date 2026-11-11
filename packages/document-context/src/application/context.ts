/**
 * Internal contracts shared by the application runtime.
 *
 * Everything in this module is internal: the public surface lives in `src/application/api`.
 */

import type { HostAdapter } from '../domain/ports/host'
import type { SsrPort } from '../domain/ports/ssr'
import type { Host } from '../domain/model/session'
import type { TokenLike } from '../domain/model/token'
import type { DocumentContextError } from '../domain/model/errors'
import type { ProviderRegistration } from '../domain/model/blueprint'
import type { SessionRuntime } from './session'

/** The ports a composition root hands to `createApplication`. */
export interface ApplicationPorts {
    /** The host adapter: connectivity, scheduling, scope transport and keyed identity. */
    readonly host: HostAdapter
    /** Optional SSR support for placeholder hosts. */
    readonly ssr?: SsrPort
}

/** Application level limits. */
export interface ApplicationLimits {
    /** How many keyed sessions may be suspended at the same time. Defaults to `32`. */
    readonly maxSuspendedSessions: number
    /** How many injections may be pending at the same time. Defaults to `1024`. */
    readonly maxPendingInjections: number
}

/** The default application limits. */
export const DEFAULT_LIMITS: ApplicationLimits = Object.freeze({
    maxSuspendedSessions: 32,
    maxPendingInjections: 1024,
})

/**
 * The key of a dependency cache.
 *
 * Single-value registrations are cached by token, because the last registration of a token wins.
 * Multi registrations are cached by their registration, because several registrations of the same
 * token coexist and each one owns its value.
 */
export type ProviderCacheKey = TokenLike | ProviderRegistration

/** A cache slot for a `scoped` or `singleton` dependency. */
export interface CacheSlot {
    /** The resolved value, once the factory settled successfully. */
    value?: unknown
    /** The in-flight promise, while the factory is running. */
    promise?: Promise<unknown>
    /** Whether the value is available. */
    resolved: boolean
}

/** The direction `injectAll` walks the scope chain in. */
export type InjectDirection = 'from-bottom-to-top' | 'from-top-to-bottom'

/** A pending injection request. */
export interface PendingRequest {
    /** The requested token. */
    readonly token: TokenLike
    /** Whether the request collects every provider. */
    readonly multi: boolean
    /** The direction used to order multi results. */
    readonly direction: InjectDirection
    /** The host the request originates from. */
    readonly host: Host
    /** The session that owns the request, when the target was a session. */
    readonly origin: SessionRuntime<any> | null
    /** Whether the request survives a disconnect of the target. */
    readonly wait: boolean
    /** Whether the request already settled. */
    settled: boolean
    /** Resolve the request with the collected values. */
    resolve(values: unknown[]): void
    /** Reject the request. */
    reject(error: DocumentContextError): void
    /** Release every resource the request holds. */
    release(): void
}

/**
 * The runtime shell of an application.
 *
 * Every piece of mutable state lives here, never at module level: the host index, the keyed
 * suspension table, the singleton slots and the pending injection table.
 */
export interface ApplicationRuntime {
    /** The ports this application was built with. */
    readonly ports: ApplicationPorts
    /** The application level limits. */
    readonly limits: ApplicationLimits
    /** Sessions by host. */
    readonly sessions: Map<Host, SessionRuntime<any>>
    /** Suspended keyed sessions by token. */
    readonly keyed: Map<string, SessionRuntime<any>>
    /** Singleton slots by token. */
    readonly singletons: Map<ProviderCacheKey, CacheSlot>
    /** The session that registered a singleton token first. */
    readonly singletonOwners: Map<TokenLike, SessionRuntime<any>>
    /** The registration that won a singleton token. */
    readonly singletonRegistrations: Map<TokenLike, ProviderRegistration>
    /** Pending injection requests. */
    readonly pending: Set<PendingRequest>
    /** The order in which keyed sessions were suspended. */
    readonly suspendedOrder: string[]
    /** Whether the application was released. */
    readonly released: boolean
    /** Register a session under its host. */
    registerSession(session: SessionRuntime<any>): void
    /** Remove a session from the host index. */
    unregisterSession(session: SessionRuntime<any>): void
    /** Notify observers that the set of sessions changed. */
    notifySessionsChanged(): void
    /** Observe session set changes. */
    onSessionsChanged(listener: () => void): () => void
}
