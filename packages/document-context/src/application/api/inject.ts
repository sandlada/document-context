/**
 * `inject` / `inject$` — resolve a single dependency.
 *
 * A single-value injection is always **nearest-wins**: the closest active provider along the
 * composed ancestor chain answers, regardless of how many other providers exist.
 */

import { Observable } from 'rxjs'
import { DocumentContextError } from '../../domain/model/errors'
import { isSession, type Host, type LateTarget } from '../../domain/model/session'
import type { TokenLike } from '../../domain/model/token'
import { assertResolvableToken } from '../../domain/model/token'
import type { ApplicationRuntime, PendingRequest } from '../context'
import type { SessionRuntime } from '../session'
import { assertOwnedSession } from '../application/isolation'
import { createPendingRequest, retryPendingRequest } from '../pending'
import { dispatchRequest, locateSingle, resolveProviderValue } from '../resolver'

/** Options of a single-value injection. */
export interface InjectOptions {
    /**
     * Whether the injection waits for a provider that may appear later.
     *
     * Element targets always wait by default; session targets reject with `UNKNOWN_SERVICE`
     * instead.
     */
    readonly wait?: boolean
}

/** An injection that can be cancelled. */
export interface CancellableInjection {
    /** The promise that settles with the resolved value. */
    readonly promise: Promise<unknown>
    /** Cancel the injection. The pending request is released. */
    cancel(): void
}

/**
 * Start an injection.
 *
 * @param runtime - The application runtime.
 * @param token - The token to resolve.
 * @param options - The injection options.
 * @param target - The injection target: an element or a session.
 * @returns The cancellable injection.
 */
export function beginInjection<TTarget = unknown>(
    runtime: ApplicationRuntime,
    token: TokenLike,
    options: InjectOptions | undefined,
    target: LateTarget<TTarget>,
): CancellableInjection {
    assertResolvableToken(token)
    const wait = options?.wait ?? false
    let origin: SessionRuntime<any> | null = null
    let host: Host

    if (isSession(target)) {
        origin = assertOwnedSession(runtime, target)
        if (origin.isDisposed) {
            return rejected(
                new DocumentContextError(
                    'DISPOSED_SESSION',
                    'The session was disposed and cannot resolve dependencies.',
                ),
            )
        }
        host = origin.adapterHost
    } else {
        const resolved = runtime.ports.host.scope.hostOf(target)
        if (resolved === null) {
            if (runtime.ports.ssr !== undefined) {
                // On the server an injection can only target a session; there are no elements.
                return rejected(
                    new DocumentContextError(
                        'UNKNOWN_SERVICE',
                        'The server resolves dependencies from a session, not from an element.',
                    ),
                )
            }
            return rejected(
                new DocumentContextError(
                    'HOST_INVALID',
                    'The injection target is not a supported element.',
                ),
            )
        }
        host = resolved
        if (!runtime.ports.host.connectivity.isConnected(host) && !wait) {
            return rejected(
                new DocumentContextError(
                    'UNCONNECTED_HOST',
                    'The injection target is not connected to the document.',
                ),
            )
        }
    }

    const location = locateSingle(runtime, host, token, origin)
    if (location.kind === 'local') {
        return {
            promise: resolveProviderValue(runtime, location.session, location.registration),
            cancel: () => undefined,
        }
    }
    if (location.kind === 'foreign' || !runtime.ports.host.scope.authoritative) {
        // The provider may live in another application or another bundle: ask the event bus.
        const values = dispatchRequest(runtime, host, token, false)
        const first = values[0]
        if (first !== undefined) {
            return {
                promise: Promise.resolve(first),
                cancel: () => undefined,
            }
        }
    }
    if (origin !== null && !wait) {
        return rejected(
            new DocumentContextError(
                'UNKNOWN_SERVICE',
                `No provider for "${label(token)}" was found.`,
                { details: { token: label(token) } },
            ),
        )
    }

    let resolveFn: ((value: unknown) => void) | null = null
    let rejectFn: ((error: unknown) => void) | null = null
    const promise = new Promise<unknown>((resolve, reject) => {
        resolveFn = resolve
        rejectFn = reject
    })
    let pending: PendingRequest
    try {
        pending = createPendingRequest(runtime, {
            token,
            multi: false,
            direction: 'from-bottom-to-top',
            host,
            origin,
            wait,
            onResolve: (values) => resolveFn?.(values[0]),
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
 * Resolve a single dependency.
 *
 * @param runtime - The application runtime.
 * @param token - The token to resolve.
 * @param options - The injection options.
 * @param target - The injection target.
 * @returns A promise with the resolved value.
 */
export function injectToken<T, TTarget = unknown>(
    runtime: ApplicationRuntime,
    token: TokenLike<T>,
    options: InjectOptions | undefined,
    target: LateTarget<TTarget>,
): Promise<T> {
    return beginInjection(runtime, token, options, target).promise as Promise<T>
}

/**
 * Resolve a single dependency as a stream.
 *
 * The stream emits one value and completes. Unsubscribing completes the stream without an error.
 *
 * @param runtime - The application runtime.
 * @param token - The token to resolve.
 * @param options - The injection options.
 * @param target - The injection target.
 * @returns The observable.
 */
export function injectToken$<T, TTarget = unknown>(
    runtime: ApplicationRuntime,
    token: TokenLike<T>,
    options: InjectOptions | undefined,
    target: LateTarget<TTarget>,
): Observable<T> {
    return new Observable<T>((subscriber) => {
        const injection = beginInjection(runtime, token, options, target)
        injection.promise.then(
            (value) => {
                if (subscriber.closed) {
                    return
                }
                subscriber.next(value as T)
                subscriber.complete()
            },
            (error: unknown) => {
                if (subscriber.closed) {
                    return
                }
                subscriber.error(
                    error instanceof DocumentContextError
                        ? error
                        : new DocumentContextError('UNKNOWN_SERVICE', String(error)),
                )
            },
        )
        return () => {
            injection.cancel()
        }
    })
}

function rejected(error: DocumentContextError): CancellableInjection {
    return {
        promise: Promise.reject(error),
        cancel: () => undefined,
    }
}

function label(token: TokenLike): string {
    return typeof token === 'string' ? token : token.name
}
