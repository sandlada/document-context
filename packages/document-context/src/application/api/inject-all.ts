/**
 * `injectAll` / `injectAll$` — collect every multi-value provider of a token.
 *
 * Only registrations declared with `multi: true` are collected. A single-value injection stays
 * nearest-wins, even when multi registrations exist.
 */

import { Observable } from 'rxjs'
import { DocumentContextError } from '../../domain/model/errors'
import { isSession, type Host, type LateTarget } from '../../domain/model/session'
import type { TokenLike } from '../../domain/model/token'
import { assertResolvableToken } from '../../domain/model/token'
import type { ApplicationRuntime, InjectDirection, PendingRequest } from '../context'
import type { SessionRuntime } from '../session'
import { assertOwnedSession } from '../application/isolation'
import { createPendingRequest, retryPendingRequest } from '../pending'
import { resolveMultiGroups, settleInjectGroups } from '../multi-resolve'
import { dispatchMultiRequest, locateMulti } from '../resolver'
import { completeOnUnsubscribe } from './complete-on-unsubscribe'

/** Options of a multi-value injection. */
export interface InjectAllOptions {
    /** Whether the injection waits for a provider that may appear later. */
    readonly wait?: boolean
    /** The order of the results along the scope chain. Defaults to `from-bottom-to-top`. */
    readonly direction?: InjectDirection
}

/**
 * Start a multi-value injection.
 *
 * @param runtime - The application runtime.
 * @param token - The token to collect.
 * @param options - The injection options.
 * @param target - The injection target.
 * @returns The promise with the collected values.
 */
export function beginInjectAll<TTarget = unknown>(
    runtime: ApplicationRuntime,
    token: TokenLike,
    options: InjectAllOptions | undefined,
    target: LateTarget<TTarget>,
): { promise: Promise<unknown[]>; cancel: () => void } {
    assertResolvableToken(token)
    const wait = options?.wait ?? false
    const direction = options?.direction ?? 'from-bottom-to-top'
    let origin: SessionRuntime<any> | null = null
    let host: Host

    if (isSession(target)) {
        origin = assertOwnedSession(runtime, target)
        if (origin.isDisposed) {
            return {
                promise: Promise.reject(
                    new DocumentContextError(
                        'DISPOSED_SESSION',
                        'The session was disposed and cannot resolve dependencies.',
                    ),
                ),
                cancel: () => undefined,
            }
        }
        host = origin.adapterHost
    } else {
        const resolved = runtime.ports.host.scope.hostOf(target)
        if (resolved === null) {
            const error = runtime.ports.ssr === undefined
                ? new DocumentContextError(
                    'HOST_INVALID',
                    'The injection target is not a supported element.',
                )
                : new DocumentContextError(
                    'UNKNOWN_SERVICE',
                    'The server resolves dependencies from a session, not from an element.',
                )
            return {
                promise: Promise.reject(error),
                cancel: () => undefined,
            }
        }
        host = resolved
        if (!runtime.ports.host.connectivity.isConnected(host) && !wait) {
            return {
                promise: Promise.reject(
                    new DocumentContextError(
                        'UNCONNECTED_HOST',
                        'The injection target is not connected to the document.',
                    ),
                ),
                cancel: () => undefined,
            }
        }
    }

    const location = locateMulti(runtime, host, token, origin)
    if (location.kind === 'local') {
        return {
            promise: resolveMultiGroups(runtime, location.groups, direction),
            cancel: () => undefined,
        }
    }
    if (location.kind === 'foreign' || !runtime.ports.host.scope.authoritative) {
        // The providers may live in another application or another bundle: ask the event bus.
        const groups = dispatchMultiRequest(runtime, host, token)
        if (groups.length > 0) {
            return {
                promise: settleInjectGroups(groups, direction),
                cancel: () => undefined,
            }
        }
    }
    if (origin !== null && !wait) {
        // A session target never grows new registrations: an empty result is final
        // unless the caller asked to wait for a provider that may appear later.
        return {
            promise: Promise.resolve([]),
            cancel: () => undefined,
        }
    }

    let resolveFn: ((value: unknown[]) => void) | null = null
    let rejectFn: ((error: unknown) => void) | null = null
    const promise = new Promise<unknown[]>((resolve, reject) => {
        resolveFn = resolve
        rejectFn = reject
    })
    let pending: PendingRequest
    try {
        pending = createPendingRequest(runtime, {
            token,
            multi: true,
            direction,
            host,
            origin,
            wait,
            onResolve: (values) => resolveFn?.(values),
            onReject: (error) => rejectFn?.(error),
        })
    } catch (error) {
        return {
            promise: Promise.reject(error),
            cancel: () => undefined,
        }
    }
    retryPendingRequest(runtime, pending)
    return {
        promise,
        cancel: () => {
            pending.release()
        },
    }
}

/**
 * Collect every multi-value provider of a token.
 *
 * @param runtime - The application runtime.
 * @param token - The token to collect.
 * @param options - The injection options.
 * @param target - The injection target.
 * @returns A promise with the collected values.
 */
export function injectAllTokens<T, TTarget = unknown>(
    runtime: ApplicationRuntime,
    token: TokenLike<T>,
    options: InjectAllOptions | undefined,
    target: LateTarget<TTarget>,
): Promise<T[]> {
    return beginInjectAll(runtime, token, options, target).promise as Promise<T[]>
}

/**
 * Collect every multi-value provider of a token as a stream.
 *
 * The stream emits once and completes. On a session target an empty collection completes
 * immediately; on an element target an empty collection never concludes.
 *
 * @param runtime - The application runtime.
 * @param token - The token to collect.
 * @param options - The injection options.
 * @param target - The injection target.
 * @returns The observable.
 */
export function injectAllTokens$<T, TTarget = unknown>(
    runtime: ApplicationRuntime,
    token: TokenLike<T>,
    options: InjectAllOptions | undefined,
    target: LateTarget<TTarget>,
): Observable<T[]> {
    return new Observable<T[]>((subscriber) => {
        const gate = completeOnUnsubscribe(subscriber)
        const injection = beginInjectAll(runtime, token, options, target)
        injection.promise.then(
            (values) => {
                if (gate.isFinished() || subscriber.closed) {
                    return
                }
                gate.markFinished()
                subscriber.next(values as T[])
                subscriber.complete()
            },
            (error: unknown) => {
                if (gate.isFinished() || subscriber.closed) {
                    return
                }
                gate.markFinished()
                subscriber.error(
                    error instanceof DocumentContextError
                        ? error
                        : new DocumentContextError('UNKNOWN_SERVICE', String(error)),
                )
            },
        )
        return () => {
            gate.markFinished()
            injection.cancel()
        }
    })
}

