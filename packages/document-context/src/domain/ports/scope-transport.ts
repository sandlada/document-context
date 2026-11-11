/**
 * Scope transport port.
 *
 * The transport has two responsibilities: resolving a scope **inside one application** through an
 * in-memory index, and carrying the **Context Protocol** event bus that lets independent
 * applications (and third-party implementations) resolve across each other.
 */

import type { Host } from '../model/session'
import type { TokenLike } from '../model/token'

/**
 * The fact that a host provides a token.
 *
 * The declaration carries no value: values live inside the owning application. `owner` is the
 * opaque identity of that application.
 */
export interface ProviderDeclaration {
    /**
     * The provided token.
     *
     * Public tokens are `namespace:name` strings; private tokens keep their object identity and
     * therefore never leave the application that owns them.
     */
    readonly token: TokenLike
    /** The opaque identity of the application that owns the provider. */
    readonly owner: object
    /**
     * Whether the registration is a multi-value registration.
     *
     * `multi: true` registrations are collected by `injectAll` / `injectAll$` only; they never
     * answer a single-value `inject`.
     */
    readonly multi: boolean
}

/**
 * The `detail` payload of a `context-request` event.
 *
 * The token travels in the normative `context` field so that other Context Protocol
 * implementations can interoperate.
 */
export interface ContextRequestDetail {
    /** The requested token name (`namespace:name`). */
    readonly context: string
    /** Called by the provider that answers the request. */
    readonly callback: (value: unknown) => void
    /** `true` when the consumer collects every provider along the chain. */
    readonly multi?: boolean
    /**
     * Termination flag for single-value requests.
     *
     * The first valid responder sets it to `true`; later providers skip. Nearest-wins therefore
     * never depends on `stopPropagation()`.
     */
    resolved?: boolean
}

/** Groups multi callbacks that come from the same host during one `context-request`. */
export const contextRequestSource = Symbol('document-context.request-source')

/** The kinds of Context Protocol announcements a transport can broadcast. */
export type ContextAnnouncement = 'mount' | 'dispose'

/**
 * Scope transport and Context Protocol event bus.
 */
export interface ScopeTransportPort {
    /**
     * Whether this transport sees every provider of the environment.
     *
     * An authoritative transport may treat a miss as final. A transport that shares its environment
     * with other bundles is **not** authoritative: a token it cannot see may still be provided
     * elsewhere, so the Context Protocol bus has to be asked before the miss becomes final.
     */
    readonly authoritative: boolean
    /**
     * Resolve a raw injection target into a stable host handle.
     *
     * @param target - The raw target (an element in the browser).
     * @returns The host handle, or `null` when the target is not supported.
     */
    hostOf(target: unknown): Host | null
    /**
     * Whether `descendant` lives inside `ancestor`.
     *
     * @param ancestor - The ancestor host.
     * @param descendant - The candidate descendant host.
     * @returns `true` when the descendant is inside the ancestor.
     */
    contains(ancestor: Host, descendant: Host): boolean
    /**
     * The provider declarations registered for a host.
     *
     * @param host - The host to inspect.
     * @returns The declarations, empty when the host provides nothing.
     */
    declarationsOf(host: Host): readonly ProviderDeclaration[]
    /**
     * Register the provider declarations of a host.
     *
     * @param host - The host.
     * @param declarations - The declarations.
     */
    declare(host: Host, declarations: readonly ProviderDeclaration[]): void
    /**
     * Remove every declaration of a host.
     *
     * @param host - The host.
     */
    undeclare(host: Host): void
    /**
     * Listen for `context-request` events reaching a host.
     *
     * @param host - The host to listen on.
     * @param handler - The handler invoked with the event detail.
     * @returns A function that removes the listener.
     */
    onRequest(host: Host, handler: (detail: ContextRequestDetail) => void): () => void
    /**
     * Dispatch a `context-request` from a host.
     *
     * @param host - The host the request originates from.
     * @param detail - The request detail.
     */
    request(host: Host, detail: ContextRequestDetail): void
    /**
     * Announce `context-mount` or `context-dispose` on a host.
     *
     * @param host - The host.
     * @param type - Which announcement to publish.
     * @param token - The keyed identity of the session, or `null` for anonymous sessions.
     */
    announce(host: Host, type: ContextAnnouncement, token: string | null): void
    /**
     * Observe "some provider became available" notifications.
     *
     * @param listener - Invoked when a provider appears anywhere in the environment.
     * @returns A function that removes the listener.
     */
    onProviderChange(listener: () => void): () => void
}
