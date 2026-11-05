/**
 * Scheduling helpers.
 *
 * Every time-dependent behaviour of the library goes through the scheduler port, so tests can
 * drive them deterministically.
 */

import type { Host } from '../domain/model/session'
import type { ApplicationRuntime } from './context'

/**
 * Schedule the microtask re-attachment check.
 *
 * A node that left the document may be moved back within the same task. The check therefore waits
 * for one microtask and only reports a disconnect when the node is still detached afterwards.
 *
 * @param runtime - The application runtime.
 * @param host - The host to re-check.
 * @param onDisconnected - Called when the host is confirmed disconnected.
 */
export function scheduleRecheck(
    runtime: ApplicationRuntime,
    host: Host,
    onDisconnected: () => void,
): void {
    runtime.ports.host.scheduler.microtask(() => {
        if (!runtime.ports.host.connectivity.isConnected(host)) {
            onDisconnected()
        }
    })
}
