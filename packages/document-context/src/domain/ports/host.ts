/**
 * HostPort: the driven port abstracting a physical host node.
 *
 * This module declares types only and performs no runtime work. It never
 * touches the DOM, installs no listeners, and starts no timers: `on()` only
 * describes how an adapter subscribes to native events. It stays importable
 * in a plain Node environment.
 */
import type { Observable } from 'rxjs'

/**
 * Lifecycle event of a host: connection, disconnection, or adoption by a new
 * owner. `connect` is the host event; `mounted` is the separate Session
 * `lifecycle$` event.
 */
export type HostLifecycleEvent =
    | { readonly type: 'connect' }
    | { readonly type: 'disconnect' }
    | { readonly type: 'adopt', readonly owner: unknown }

/**
 * Driven port abstracting a physical host node and its scope position. The
 * scope chain resolves through `parent` links; services walk ancestor hosts
 * while state never crosses sessions.
 *
 * The public surface binds `Native` to `HTMLElement`; the domain keeps it
 * `unknown` so this module loads with no DOM.
 *
 * @param Native Type of the underlying native node (default `unknown`).
 */
export interface HostPort<Native = unknown> {
    /** Normalized keyed identity, or null for an anonymous host. */
    readonly token: string | null
    /** Whether the host is currently connected to its document. */
    readonly isConnected: boolean
    /** Parent scope host, or null at the scope root. */
    readonly parent: HostPort<Native> | null
    /** Hot stream of `connect`, `disconnect`, and `adopt` host events. */
    readonly lifecycle$: Observable<HostLifecycleEvent>
    /**
     * Subscribes to a native event (for example `input`) without the library
     * taking over DOM writes. Options pass through to the native subscription.
     *
     * @param type Native event name to listen for.
     * @param listener Callback invoked with each native event.
     * @param options Optional capture, passive, once, and abort-signal flags.
     * An already-aborted signal attaches nothing and returns a no-op.
     * @returns Unsubscribe function removing the listener; idempotent.
     * @example
     * ```ts
     * import type { HostPort } from './host.js'
     *
     * const observeInput = (host: HostPort, onValue: (value: unknown) => void): (() => void) => {
     *     return host.on('input', onValue, { passive: true })
     * }
     * ```
     */
    on(
        type: string,
        listener: (event: unknown) => void,
        options?: {
            readonly capture?: boolean
            readonly passive?: boolean
            readonly once?: boolean
            readonly signal?: AbortSignal
        },
    ): () => void
    /**
     * Escape hatch returning the underlying native node for direct calls such
     * as `focus()`, `setAttribute()`, or `getBoundingClientRect()`.
     *
     * @returns The underlying native node.
     * @example
     * ```ts
     * import type { HostPort } from './host.js'
     *
     * const focusHost = (host: HostPort<HTMLElement>): void => {
     *     host.native().focus()
     * }
     * ```
     */
    native(): Native
}
