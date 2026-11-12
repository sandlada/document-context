/**
 * Pending injections.
 *
 * An injection on an element waits until a provider shows up. The request is registered here so
 * that it can be retried whenever the environment changes, and so that it can be ended when the
 * target disconnects or its session is disposed.
 */

import { DocumentContextError } from '../domain/model/errors'
import type { Host } from '../domain/model/session'
import type { TokenLike } from '../domain/model/token'
import type { ApplicationRuntime, InjectDirection, PendingRequest } from './context'
import type { SessionRuntime } from './session'
import { resolveMultiGroups, settleInjectGroups } from './multi-resolve'
import {
    chainFrom,
    dispatchMultiRequest,
    dispatchRequest,
    locateMulti,
    locateSingle,
    resolveProviderValue,
} from './resolver'

/** The options of a pending request. */
export interface PendingRequestOptions {
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
    /** Called when the request resolves. */
    readonly onResolve: (values: unknown[]) => void
    /** Called when the request fails. */
    readonly onReject: (error: DocumentContextError) => void
}

/**
 * Create a pending request and register it on the application.
 *
 * @param runtime - The application runtime.
 * @param options - The request options.
 * @returns The pending request.
 * @throws A `DocumentContextError` with code `PENDING_LIMIT_EXCEEDED` when the application limit is
 * reached.
 */
export function createPendingRequest(
    runtime: ApplicationRuntime,
    options: PendingRequestOptions,
): PendingRequest {
    if (runtime.pending.size >= runtime.limits.maxPendingInjections) {
        throw new DocumentContextError(
            'PENDING_LIMIT_EXCEEDED',
            'The application reached its limit of pending injections.',
            { details: { limit: runtime.limits.maxPendingInjections } },
        )
    }
    const { connectivity, scheduler } = runtime.ports.host
    let unsubscribe: (() => void) | null = null
    let detachOrigin: (() => void) | null = null
    const request: PendingRequest = {
        token: options.token,
        multi: options.multi,
        direction: options.direction,
        host: options.host,
        origin: options.origin,
        wait: options.wait,
        settled: false,
        resolve(values: unknown[]): void {
            if (request.settled) {
                return
            }
            request.settled = true
            release()
            options.onResolve(values)
        },
        reject(error: DocumentContextError): void {
            if (request.settled) {
                return
            }
            request.settled = true
            release()
            options.onReject(error)
        },
        release(): void {
            release()
        },
    }
    const release = (): void => {
        unsubscribe?.()
        unsubscribe = null
        stopStructure()
        stopSessions()
        detachOwner()
        runtime.pending.delete(request)
    }
    let watchedOwner: SessionRuntime<any> | null = null
    const detachOwner = (): void => {
        detachOrigin?.()
        detachOrigin = null
        watchedOwner = null
    }
    const watchOwnerAbort = (owner: SessionRuntime<any>): void => {
        detachOwner()
        watchedOwner = owner
        const onOwnerDisposed = (): void => {
            if (request.settled) {
                return
            }
            // The element may have moved before this session aborted. The wait belongs to the
            // session that currently contains the target, not the one it started under.
            if (
                options.origin === null &&
                !chainFrom(options.host).includes(owner.adapterHost)
            ) {
                bindNearestOwner()
                schedulePendingRetry(runtime)
                return
            }
            const reason = owner.abortSignal.reason
            request.reject(
                reason instanceof DocumentContextError
                    ? reason
                    : new DocumentContextError(
                          'DISPOSED_SESSION',
                          'The session was disposed before the injection could finish.',
                      ),
            )
        }
        if (owner.abortSignal.aborted) {
            onOwnerDisposed()
        } else {
            owner.abortSignal.addEventListener('abort', onOwnerDisposed, { once: true })
            detachOrigin = () => {
                owner.abortSignal.removeEventListener('abort', onOwnerDisposed)
            }
        }
    }
    const bindNearestOwner = (): void => {
        if (options.origin !== null || request.settled) {
            return
        }
        const owner = nearestSession(runtime, options.host)
        if (owner === watchedOwner) {
            return
        }
        if (owner === null) {
            detachOwner()
            return
        }
        watchOwnerAbort(owner)
    }
    const stopSessions =
        options.origin === null
            ? runtime.onSessionsChanged(() => {
                  bindNearestOwner()
              })
            : () => undefined
    if (options.origin !== null) {
        watchOwnerAbort(options.origin)
    } else {
        bindNearestOwner()
    }
    const structureStops: (() => void)[] = []
    const stopStructure = (): void => {
        for (const stop of structureStops.splice(0)) {
            stop()
        }
    }
    const watchStructure = (): void => {
        stopStructure()
        if (request.settled) {
            return
        }
        for (const host of chainFrom(options.host)) {
            structureStops.push(
                connectivity.subscribeStructure(host, () => {
                    if (request.settled) {
                        return
                    }
                    watchStructure()
                    bindNearestOwner()
                    schedulePendingRetry(runtime)
                }),
            )
        }
    }
    watchStructure()
    unsubscribe = connectivity.subscribe(options.host, (connected) => {
        if (connected) {
            return
        }
        scheduler.microtask(() => {
            if (request.settled || options.wait) {
                return
            }
            if (connectivity.isConnected(options.host)) {
                return
            }
            request.reject(
                new DocumentContextError(
                    'UNCONNECTED_HOST',
                    'The target element was disconnected before a provider appeared.',
                ),
            )
        })
    })
    runtime.pending.add(request)
    return request
}

/**
 * Schedule a batched wake-up of the pending requests.
 *
 * The wake-up runs on the scheduler so that tests stay deterministic.
 *
 * @param runtime - The application runtime.
 */
export function schedulePendingRetry(runtime: ApplicationRuntime): void {
    runtime.ports.host.scheduler.microtask(() => {
        retryPendingRequests(runtime)
    })
}

/**
 * Retry every pending request of an application.
 *
 * @param runtime - The application runtime.
 */
export function retryPendingRequests(runtime: ApplicationRuntime): void {
    for (const request of [...runtime.pending]) {
        retryPendingRequest(runtime, request)
    }
}

/**
 * Retry a single pending request.
 *
 * @param runtime - The application runtime.
 * @param request - The request.
 */
export function retryPendingRequest(runtime: ApplicationRuntime, request: PendingRequest): void {
    if (request.settled) {
        return
    }
    if (request.multi) {
        const location = locateMulti(runtime, request.host, request.token, request.origin)
        if (location.kind === 'local') {
            void resolveMultiGroups(runtime, location.groups, request.direction).then(
                (values) => request.resolve(values),
                (error: unknown) => request.reject(toError(error)),
            )
            return
        }
        if (location.kind === 'foreign' || !runtime.ports.host.scope.authoritative) {
            const groups = dispatchMultiRequest(runtime, request.host, request.token)
            if (groups.length > 0) {
                void settleInjectGroups(groups, request.direction).then(
                    (settled) => request.resolve(settled),
                    (error: unknown) => request.reject(toError(error)),
                )
            }
        }
        return
    }
    const location = locateSingle(runtime, request.host, request.token, request.origin)
    if (location.kind === 'local') {
        void resolveProviderValue(
            runtime,
            location.session,
            location.registration,
        ).then(
            (value) => request.resolve([value]),
            (error: unknown) => request.reject(toError(error)),
        )
        return
    }
    if (location.kind === 'foreign' || !runtime.ports.host.scope.authoritative) {
        const values = dispatchRequest(runtime, request.host, request.token, false)
        const first = values[0]
        if (first !== undefined) {
            void Promise.resolve(first).then(
                (value) => request.resolve([value]),
                (error: unknown) => request.reject(toError(error)),
            )
        }
    }
}

function nearestSession(
    runtime: ApplicationRuntime,
    host: Host,
): SessionRuntime<any> | null {
    for (const candidate of chainFrom(host)) {
        const session = runtime.sessions.get(candidate)
        if (session !== undefined && !session.isDisposed) {
            return session
        }
    }
    return null
}

function toError(error: unknown): DocumentContextError {
    if (error instanceof DocumentContextError) {
        return error
    }
    const cause = error instanceof Error ? error : new Error(String(error))
    return new DocumentContextError('UNKNOWN_SERVICE', cause.message, { details: { cause } })
}
