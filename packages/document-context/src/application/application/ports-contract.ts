/**
 * The ports contract of an application.
 *
 * `createApplication` accepts a host adapter and an optional SSR port. The host adapter carries the
 * four collaborators that always travel together: connectivity, scheduling, scope transport and
 * keyed identity.
 */

import { DocumentContextError } from '../../domain/model/errors'
import type { HostAdapter } from '../../domain/ports/host'
import type { SsrPort } from '../../domain/ports/ssr'
import type { Host } from '../../domain/model/session'
import type { ApplicationLimits, ApplicationPorts } from '../context'
import { DEFAULT_LIMITS } from '../context'

/** The options of `createApplication`. */
export interface ApplicationOptions<
    THost extends Host = Host,
    TTarget = unknown,
> {
    /** The host adapter. */
    readonly host: HostAdapter<THost, TTarget>
    /** Optional SSR support for placeholder hosts. */
    readonly ssr?: SsrPort
    /** Overrides for the application level limits. */
    readonly limits?: Partial<ApplicationLimits>
}

/**
 * Validate the ports and resolve the limits.
 *
 * @param options - The application options.
 * @returns The resolved ports and limits.
 * @throws A `DocumentContextError` with code `INVALID_OPTIONS` when the host adapter is incomplete.
 */
export function buildPorts<THost extends Host, TTarget>(options: ApplicationOptions<THost, TTarget>): {
    ports: ApplicationPorts
    limits: ApplicationLimits
} {
    const host = options.host
    if (
        host === undefined ||
        host === null ||
        typeof host.normalize !== 'function' ||
        host.connectivity === undefined ||
        host.scheduler === undefined ||
        host.scope === undefined ||
        host.tokens === undefined
    ) {
        throw new DocumentContextError(
            'INVALID_OPTIONS',
            'The host adapter must provide normalize, connectivity, scheduler, scope and tokens.',
        )
    }
    const limits: ApplicationLimits = Object.freeze({
        maxSuspendedSessions:
            options.limits?.maxSuspendedSessions ?? DEFAULT_LIMITS.maxSuspendedSessions,
        maxPendingInjections:
            options.limits?.maxPendingInjections ?? DEFAULT_LIMITS.maxPendingInjections,
    })
    const ports: ApplicationPorts = options.ssr === undefined
        ? { host }
        : { host, ssr: options.ssr }
    return { ports, limits }
}
