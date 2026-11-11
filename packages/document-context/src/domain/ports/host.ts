/**
 * Host adapter port.
 *
 * The host adapter is the boundary between "a thing the caller pointed at" and the internal host
 * representation. It also carries the four collaborators that always travel together with it:
 * connectivity, scheduling, scope transport and keyed identity.
 */

import type { Host } from '../model/session'
import type { SchedulerPort } from './scheduler'
import type { ScopeTransportPort } from './scope-transport'

/**
 * Answers "is this host connected right now?" and reports when the answer changes.
 *
 * The whole lifecycle model is driven by connectivity, so this port is what makes the library
 * usable outside the browser.
 */
export interface ConnectivityPort {
    /**
     * The current connectivity of a host.
     *
     * @param host - The host to inspect.
     * @returns `true` when the host is attached to its environment.
     */
    isConnected(host: Host): boolean
    /**
     * Subscribe to connectivity changes of a host.
     *
     * The listener is only invoked when the value actually changes.
     *
     * @param host - The host to watch.
     * @param listener - Invoked with the new connectivity.
     * @returns A function that removes the subscription.
     */
    subscribe(host: Host, listener: (connected: boolean, owner?: unknown) => void): () => void
    /**
     * Subscribe to ancestor-chain changes that keep the host connected.
     *
     * Moving a node inside the document is not a disconnect, but it can change which session is
     * nearest. Listeners are not told that the host connected or disconnected.
     *
     * @param host - The host to watch.
     * @param listener - Invoked when the host's parent changes while it stays in a document.
     * @returns A function that removes the subscription.
     */
    subscribeStructure(host: Host, listener: () => void): () => void
}

/**
 * Reads and writes the keyed identity stored on the host.
 *
 * In the browser the identity lives in the `data-context-key` attribute. Reads and writes share
 * the token name validation used by `defineToken`.
 */
export interface TokensPort {
    /**
     * Read the keyed identity of a host.
     *
     * @param host - The host to read.
     * @returns The token name, or `null` when the host carries none.
     */
    read(host: Host): string | null
    /**
     * Write the keyed identity of a host.
     *
     * @param host - The host to write.
     * @param token - The token name.
     */
    write(host: Host, token: string): void
    /**
     * Remove the keyed identity of a host when it still belongs to the given token.
     *
     * @param host - The host to clean up.
     * @param token - The token name the host is expected to carry.
     */
    remove(host: Host, token: string): void
}

/**
 * Normalizes mount and injection targets into hosts and provides the collaborators that travel
 * with a host.
 *
 * @typeParam THost - The host flavour produced by this adapter.
 * @typeParam TTarget - The raw target this adapter accepts.
 */
export interface HostAdapter<THost extends Host = Host, TTarget = unknown> {
    /**
     * Normalize a raw target into a host handle.
     *
     * @param target - The raw target.
     * @returns The host handle.
     * @throws A `DocumentContextError` with code `HOST_INVALID` when the target is not supported.
     */
    normalize(target: TTarget): THost
    /** Connectivity facts. */
    readonly connectivity: ConnectivityPort
    /** Time behaviour. */
    readonly scheduler: SchedulerPort
    /** Scope transport and Context Protocol bus. */
    readonly scope: ScopeTransportPort
    /** Keyed identity storage. */
    readonly tokens: TokensPort
}
