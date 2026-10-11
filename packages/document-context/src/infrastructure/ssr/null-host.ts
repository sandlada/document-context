/**
 * Server-side null host stub.
 *
 * This module provides the `HostPort` used when mounting on the server: an
 * anonymous, always-connected host with no parent, no lifecycle emissions,
 * no native-event delivery, and no native node. It performs no DOM access at
 * import or call time and carries no per-request state, so one shared
 * instance safely serves every request; the application layer detects it by
 * reference identity to skip the DOM connection gate and `onMount`.
 */
import { NEVER } from 'rxjs'
import { DocumentContextError } from '../../domain/model/errors.js'
import type { HostPort } from '../../domain/ports/host.js'

let cachedNullHost: HostPort<unknown> | null = null

/**
 * Creates (once) the server null host. Pure factory after the first call:
 * the same frozen-shape singleton returns every time because the stub holds
 * no mutable state. `lifecycle$` is `NEVER`, so subscribers simply never
 * fire; `on()` accepts any subscription and returns a no-op unsubscribe;
 * `native()` always throws `HOST_INVALID` because a server host has no node.
 *
 * @returns The shared null host.
 * @example
 * ```ts
 * import { createNullHost } from './null-host.js'
 *
 * const host = createNullHost()
 * const off = host.on('input', () => {})
 * off()
 * ```
 */
export function createNullHost(): HostPort<unknown> {
    if (cachedNullHost === null) {
        cachedNullHost = {
            token: null,
            isConnected: true,
            parent: null,
            lifecycle$: NEVER,
            on: () => () => {},
            native: (): unknown => {
                throw new DocumentContextError('HOST_INVALID', { reason: 'null-host exposes no native node' })
            },
        }
    }
    return cachedNullHost
}
