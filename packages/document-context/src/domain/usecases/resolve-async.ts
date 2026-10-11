/**
 * Async late-binding kernel: cold resolve-once watches over the scope
 * transport with first-wins cancellation.
 *
 * This module is pure orchestration over injected ports: no DOM access, no
 * real timers, no RxJS time operators. All time flows through the injected
 * `SchedulerPort`; subscription, timeout, abort, and target-death channels
 * compete first-wins inside one subscription with exactly-once settlement and
 * no residual timers or listeners. It runs in a plain Node environment.
 *
 * Semantics (domain-enforceable kernel):
 * - cold: subscribing to `transport.watch` / `transport.watchAll` starts only
 *   on subscribe; nothing resolves before subscription;
 * - single first-emit, multi first-non-empty; empty multi arrays are ignored
 *   and never complete (third-party transports that complete on empty stay
 *   pending here);
 * - abort (`signal`) completes the stream without emitting (Observable
 *   cancellation carries no reason);
 * - `scheduler.timeout` settles pending waits with `RESOLUTION_TIMEOUT`;
 * - target-session death observed via `abort$` settles with
 *   `DISPOSED_SESSION` (death is checked before hit delivery so same-batch
 *   ties resolve to death, matching the global order).
 *
 * Deferred to the application layer: per-Document pending registries with
 * `WeakRef` hosts, token-bucket batching and `maxPendingPerDocument`
 * backpressure, `context-mount` and observer wake-up sources, `session$`
 * hot tracking, Promise-face mapping (`signal.reason` rejection), and
 * `maxPendingPerDocument` overflow accounting.
 */

import { Observable } from 'rxjs'
import type { Subscription } from 'rxjs'
import { DocumentContextError } from '../model/errors.js'
import type { HostPort } from '../ports/host.js'
import type { SchedulerPort } from '../ports/scheduler.js'
import type { ScopeResolution, ScopeTransportPort } from '../ports/scope-transport.js'
import type { Token } from '../model/token.js'

/**
 * Input for {@link watchOnce}.
 */
export interface WatchOnceInput {
    /** Scope transport providing the cold `watch` / `watchAll` channels. */
    readonly transport: ScopeTransportPort
    /** Scheduler owning the `timeoutMs` timer. */
    readonly scheduler: SchedulerPort
    /** Token to resolve (string or private). */
    readonly token: Token
    /** Host starting the ancestor walk. */
    readonly from: HostPort
    /** False for single first-emit, true for multi first-non-empty. */
    readonly multi: boolean
    /** Multi direction; defaults to `bottomUp`. Ignored for single. */
    readonly direction?: 'bottomUp' | 'topDown'
    /** Consumer cancellation; abort completes without emitting. */
    readonly signal?: AbortSignal
    /** Explicit timeout budget; expiry errors with `RESOLUTION_TIMEOUT`. */
    readonly timeoutMs?: number
    /**
     * Target-session death channel. A `next` emission settles the wait with
     * `DISPOSED_SESSION`; completion without emission is ignored.
     */
    readonly abort$?: Observable<void>
}

/**
 * Cold resolve-once observable over the scope transport. Subscribing starts a
 * single `watch` (or `watchAll`) subscription; the first settlement wins and
 * settles exactly once:
 * - single: first transport emission completes the stream;
 * - multi: first non-empty emission completes; empty arrays are ignored and an
 *   empty completion stays pending;
 * - `signal` abort completes without emitting;
 * - `timeoutMs` expiry errors with `RESOLUTION_TIMEOUT` carrying
 *   `{ token, timeoutMs }`;
 * - `abort$` emission errors with `DISPOSED_SESSION`.
 *
 * Already-aborted signals complete immediately without touching the transport.
 * Unsubscribing before settlement drops the pending entry and cancels the
 * timeout, leaving no residual timers or listeners.
 *
 * @param input Transport, scheduler, token, origin, mode, and channels.
 * @returns A cold observable emitting once (single resolution or non-empty
 * multi snapshot), then completing.
 * @example
 * ```ts
 * import { watchOnce } from './resolve-async.js'
 *
 * const stream = watchOnce({ transport, scheduler, token: 'app:user', from: host, multi: false })
 * stream.subscribe((resolution) => console.log(resolution.value))
 * ```
 */
export function watchOnce<T>(
    input: WatchOnceInput,
): Observable<ScopeResolution<T> | ReadonlyArray<ScopeResolution<T>>> {
    const { transport, scheduler, token, from, multi, direction, signal, timeoutMs, abort$ } = input
    return new Observable<ScopeResolution<T> | ReadonlyArray<ScopeResolution<T>>>((subscriber) => {
        if (signal?.aborted === true) {
            subscriber.complete()
            return undefined
        }
        let settled = false
        let cancelTimeout: (() => void) | null = null
        let inner: Subscription | null = null
        let abortSub: Subscription | null = null
        let onAbort: (() => void) | null = null

        const cleanup = (): void => {
            if (cancelTimeout !== null) {
                cancelTimeout()
                cancelTimeout = null
            }
            if (onAbort !== null && signal !== undefined) {
                signal.removeEventListener('abort', onAbort)
                onAbort = null
            }
            if (abortSub !== null) {
                abortSub.unsubscribe()
                abortSub = null
            }
            if (inner !== null) {
                inner.unsubscribe()
                inner = null
            }
        }

        if (timeoutMs !== undefined) {
            cancelTimeout = scheduler.timeout(() => {
                if (settled) {
                    return
                }
                settled = true
                cleanup()
                subscriber.error(new DocumentContextError('RESOLUTION_TIMEOUT', { token, timeoutMs }))
            }, timeoutMs)
        }

        if (abort$ !== undefined) {
            const death$ = abort$ as Observable<void>
            abortSub = death$.subscribe({
                next: () => {
                    if (settled) {
                        return
                    }
                    settled = true
                    cleanup()
                    subscriber.error(new DocumentContextError('DISPOSED_SESSION', {}))
                },
            })
        }

        if (signal !== undefined) {
            onAbort = (): void => {
                if (settled) {
                    return
                }
                settled = true
                cleanup()
                subscriber.complete()
            }
            signal.addEventListener('abort', onAbort, { once: true })
        }

        if (multi) {
            const watchAllOptions: { readonly direction?: 'bottomUp' | 'topDown', readonly signal?: AbortSignal } = {
                ...(direction !== undefined ? { direction } : {}),
                ...(signal !== undefined ? { signal } : {}),
            }
            inner = transport.watchAll<T>(token, from, watchAllOptions).subscribe({
                next: (snapshot) => {
                    if (settled) {
                        return
                    }
                    if (snapshot.length === 0) {
                        return
                    }
                    settled = true
                    cleanup()
                    subscriber.next(snapshot)
                    subscriber.complete()
                },
                error: (error: unknown) => {
                    if (settled) {
                        return
                    }
                    settled = true
                    cleanup()
                    subscriber.error(error)
                },
                complete: () => {
                    if (settled) {
                        return
                    }
                    if (signal?.aborted === true) {
                        settled = true
                        cleanup()
                        subscriber.complete()
                    }
                },
            })
        } else {
            const watchOptions: { readonly signal?: AbortSignal } = {
                ...(signal !== undefined ? { signal } : {}),
            }
            inner = transport.watch<T>(token, from, watchOptions).subscribe({
                next: (resolution) => {
                    if (settled) {
                        return
                    }
                    settled = true
                    cleanup()
                    subscriber.next(resolution)
                    subscriber.complete()
                },
                error: (error: unknown) => {
                    if (settled) {
                        return
                    }
                    settled = true
                    cleanup()
                    subscriber.error(error)
                },
                complete: () => {
                    if (settled) {
                        return
                    }
                    settled = true
                    cleanup()
                    subscriber.complete()
                },
            })
        }

        return () => {
            if (!settled) {
                settled = true
            }
            cleanup()
        }
    })
}
