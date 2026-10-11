/**
 * W3C Context Protocol scope transport: resolves services along the DOM
 * ancestor chain by dispatching `context-request` events.
 *
 * DOM globals isolated here: `CustomEvent` only. Time, observation, and
 * attachment live in sibling files. The transport only dispatches events and
 * collects synchronous `detail.callback` answers; the application layer owns
 * the answering responder, and late-binding wake-ups arrive through the
 * injected {@link PendingWake}.
 */
import { Observable } from 'rxjs'
import { DocumentContextError } from '../../domain/model/errors.js'
import type { ScopeDirection } from '../../domain/model/scope.js'
import type { HostPort } from '../../domain/ports/host.js'
import type { ScopeResolution, ScopeTransportPort } from '../../domain/ports/scope-transport.js'
import type { Token } from '../../domain/model/token.js'

/**
 * Wire event name for scope resolution. Responders installed by the
 * application layer listen for exactly this name.
 *
 * @example
 * ```ts
 * import { CONTEXT_REQUEST_EVENT } from './scope-transport.js'
 *
 * element.addEventListener(CONTEXT_REQUEST_EVENT, (event) => console.log(event))
 * ```
 */
export const CONTEXT_REQUEST_EVENT = 'context-request'

/**
 * Event detail carried by every `context-request` dispatch. The callback
 * closure only collects the responder value: it never reads `event.target`,
 * so responses stay valid across shadow boundaries and realms.
 */
export interface ContextRequestDetail {
    /** Token to resolve (string or private, matched by the responder). */
    readonly token: Token
    /** Collects one responder value with its release function. */
    readonly callback: (value: unknown, unsubscribe?: () => void) => void
    /** P1 reservation flag: tolerated and passed through, never consumed. */
    readonly subscribe?: boolean
    /** True for multi snapshots (collect all), false for single (first wins). */
    readonly multi?: boolean
}

/**
 * One late-binding wake registration. `retry` re-dispatches the original
 * request; the late-binding layer (I1b) calls it when a matching token is
 * provided. Implemented by late-binding, injected here.
 */
export interface PendingWakeEntry {
    /** Token the pending watch waits for. */
    readonly token: Token
    /** Host the original request started from. */
    readonly host: HostPort
    /** Re-dispatches the request and emits fresh snapshots. */
    readonly retry: () => void
}

/**
 * Wake-up source for pending watches. `add` registers a retry entry and
 * returns its removal function; removal runs on teardown or abort.
 */
export interface PendingWake {
    /**
     * Registers a pending retry entry.
     *
     * @param entry Token, host, and retry closure to invoke on wake-up.
     * @returns Removal function dropping the entry; idempotent.
     */
    add(entry: PendingWakeEntry): () => void
}

/**
 * Construction dependencies for {@link createScopeTransport}.
 */
export interface ScopeTransportDeps {
    /** Wake-up source retrying pending watches; absence stays pending. */
    readonly wake?: PendingWake
}

/**
 * Wraps a responder value in a `ScopeResolution` whose release is
 * idempotent: repeated calls invoke the responder unsubscribe at most once.
 *
 * @param value Responder value handed to the caller.
 * @param unsubscribe Responder release function, if the responder gave one.
 * @returns The resolution snapshot.
 */
const toResolution = <T>(value: T, unsubscribe?: () => void): ScopeResolution<T> => {
    let released = false
    return {
        value,
        unsubscribe: () => {
            if (released) {
                return
            }
            released = true
            if (unsubscribe !== undefined) {
                unsubscribe()
            }
        },
    }
}

/**
 * Dispatches one `context-request` event on the native node behind `from`
 * and collects synchronous callback answers.
 *
 * The node MUST expose a callable `dispatchEvent` (duck-typed, never
 * `instanceof`); otherwise the dispatch throws `HOST_INVALID` carrying
 * `{reason: 'missing-dispatch', token}`.
 *
 * @param token Token to resolve (string or private).
 * @param from Host starting the ancestor walk; its native node is dispatched on.
 * @param subscribe P1 reservation flag passed through to the detail.
 * @param multi True for multi snapshots, false for single first-wins.
 * @returns Collected resolutions in responder invocation order.
 * @throws DocumentContextError with code `HOST_INVALID` when the native node
 * cannot dispatch events.
 */
const collectResolutions = <T>(
    token: Token,
    from: HostPort,
    subscribe: boolean | undefined,
    multi: boolean,
): Array<ScopeResolution<T>> => {
    const native: unknown = from.native()
    if (native === null || native === undefined || (typeof native !== 'object' && typeof native !== 'function')) {
        throw new DocumentContextError('HOST_INVALID', { reason: 'missing-dispatch', token })
    }
    const dispatchEvent = (native as { readonly dispatchEvent?: unknown }).dispatchEvent
    if (typeof dispatchEvent !== 'function') {
        throw new DocumentContextError('HOST_INVALID', { reason: 'missing-dispatch', token })
    }
    const collected: Array<ScopeResolution<T>> = []
    const detail: ContextRequestDetail = {
        token,
        callback: (value: unknown, unsubscribe?: () => void): void => {
            collected.push(toResolution<T>(value as T, unsubscribe))
        },
        ...(subscribe === undefined ? {} : { subscribe }),
        multi,
    }
    const event = new CustomEvent<ContextRequestDetail>(CONTEXT_REQUEST_EVENT, {
        detail,
        bubbles: true,
        composed: true,
        cancelable: true,
    })
    const dispatchOn = dispatchEvent as (event: CustomEvent<ContextRequestDetail>) => void
    dispatchOn.call(native, event)
    return collected
}

/**
 * Takes a multi snapshot ordered by direction. DOM bubbling already delivers
 * responder invocations nearest-first, which IS the `bottomUp` order
 * (same-host ties keep DOM listener registration order). `topDown` returns
 * the reversed propagation order; same-host multi ties therefore appear in
 * reverse listener order, while the common one-provider-per-host case is
 * exact. No `orderEntries` depth labels are needed because propagation order
 * is the depth signal by wire design.
 *
 * @param token Token to resolve (string or private).
 * @param from Host starting the ancestor walk.
 * @param direction `bottomUp` for nearest-first, `topDown` for outermost-first.
 * @returns Ordered resolutions, possibly empty.
 */
const snapshotAll = <T>(
    token: Token,
    from: HostPort,
    direction: ScopeDirection,
): ReadonlyArray<ScopeResolution<T>> => {
    const collected = collectResolutions<T>(token, from, undefined, true)
    if (direction === 'topDown') {
        return [...collected].reverse()
    }
    return collected
}

/**
 * Creates the W3C Context Protocol scope transport.
 *
 * `request` dispatches once and returns the nearest hit or null on a miss;
 * single responders stop propagation so the first collected hit wins.
 * `requestAll` collects every answer (responders skip `stopPropagation` for
 * multi details) ordered by direction. Both are synchronous snapshots that
 * never wait.
 *
 * `watch` / `watchAll` are cold stays-open channels (frozen cross-track
 * semantics, differing from the in-memory fake's resolve-once streams):
 * subscribing dispatches once, a single miss emits nothing while a multi
 * miss emits the raw empty snapshot, and every wake-up retry re-dispatches
 * and emits fresh snapshots. The channels complete ONLY on unsubscribe or
 * abort; resolve-once settlement (single first-emit, multi first-non-empty)
 * belongs to the domain `watchOnce` kernel, which tolerates raw channels by
 * ignoring empty multi snapshots. Aborting `signal` completes the stream and
 * drops the wake entry; an already-aborted signal completes immediately
 * without dispatching.
 *
 * Pure construction: nothing dispatches until a request runs or a watch is
 * subscribed.
 *
 * @param deps Optional wake-up source retrying pending watches.
 * @returns A `ScopeTransportPort` speaking the `context-request` wire.
 * @example
 * ```ts
 * import { createScopeTransport } from './scope-transport.js'
 * import type { HostPort } from '../../domain/ports/host.js'
 *
 * declare const from: HostPort
 * const transport = createScopeTransport()
 * const hit = transport.request<string>('app:theme', from)
 * console.log(hit?.value ?? 'miss')
 * ```
 */
export function createScopeTransport(deps: ScopeTransportDeps = {}): ScopeTransportPort {
    const wake = deps.wake
    return {
        request<T>(
            token: Token,
            from: HostPort,
            options?: { readonly subscribe?: boolean },
        ): ScopeResolution<T> | null {
            const collected = collectResolutions<T>(token, from, options?.subscribe, false)
            const first = collected[0]
            return first ?? null
        },
        requestAll<T>(
            token: Token,
            from: HostPort,
            options?: { readonly direction?: ScopeDirection },
        ): ReadonlyArray<ScopeResolution<T>> {
            return snapshotAll<T>(token, from, options?.direction ?? 'bottomUp')
        },
        watch<T>(
            token: Token,
            from: HostPort,
            options?: { readonly signal?: AbortSignal },
        ): Observable<ScopeResolution<T>> {
            return new Observable<ScopeResolution<T>>((subscriber) => {
                const signal = options?.signal
                if (signal?.aborted === true) {
                    subscriber.complete()
                    return undefined
                }
                let closed = false
                const attempt = (): void => {
                    if (closed) {
                        return
                    }
                    const hit = collectResolutions<T>(token, from, undefined, false)[0]
                    if (hit !== undefined) {
                        subscriber.next(hit)
                    }
                }
                attempt()
                const removeWake = wake?.add({ token, host: from, retry: attempt })
                const onAbort = (): void => {
                    if (closed) {
                        return
                    }
                    closed = true
                    if (removeWake !== undefined) {
                        removeWake()
                    }
                    subscriber.complete()
                }
                signal?.addEventListener('abort', onAbort, { once: true })
                return () => {
                    closed = true
                    if (removeWake !== undefined) {
                        removeWake()
                    }
                    signal?.removeEventListener('abort', onAbort)
                }
            })
        },
        watchAll<T>(
            token: Token,
            from: HostPort,
            options?: { readonly direction?: ScopeDirection, readonly signal?: AbortSignal },
        ): Observable<ReadonlyArray<ScopeResolution<T>>> {
            return new Observable<ReadonlyArray<ScopeResolution<T>>>((subscriber) => {
                const signal = options?.signal
                if (signal?.aborted === true) {
                    subscriber.complete()
                    return undefined
                }
                const direction: ScopeDirection = options?.direction ?? 'bottomUp'
                let closed = false
                const attempt = (): void => {
                    if (closed) {
                        return
                    }
                    subscriber.next(snapshotAll<T>(token, from, direction))
                }
                attempt()
                const removeWake = wake?.add({ token, host: from, retry: attempt })
                const onAbort = (): void => {
                    if (closed) {
                        return
                    }
                    closed = true
                    if (removeWake !== undefined) {
                        removeWake()
                    }
                    subscriber.complete()
                }
                signal?.addEventListener('abort', onAbort, { once: true })
                return () => {
                    closed = true
                    if (removeWake !== undefined) {
                        removeWake()
                    }
                    signal?.removeEventListener('abort', onAbort)
                }
            })
        },
    }
}
