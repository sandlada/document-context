/**
 * ScopeTransportPort: the driven port resolving services along host scope
 * chains, plus the late-binding watch channels.
 *
 * This module holds the only runtime helper in the ports layer,
 * {@link isThenable}: a duck-typing probe shared by every `MaybePromise`
 * consumer. Everything else declares types only and performs no I/O. Token
 * and host types enter by `import type` only, so they are erased at runtime
 * and this module stays importable in a plain Node environment.
 */
import type { Observable } from 'rxjs'
import type { Token } from '../model/token.js'
import type { HostPort } from './host.js'
import type { MaybePromise } from './storage.js'

/**
 * A single resolved scope value. Async provider in-flight promises pass
 * through `value` untouched for the application layer to await.
 *
 * @param T Resolved service type.
 */
export interface ScopeResolution<T = unknown> {
    /** Resolved value, or the in-flight promise of an async provider. */
    readonly value: MaybePromise<T>
    /** Releases the resolution; idempotent. */
    readonly unsubscribe: () => void
}

/**
 * Driven port resolving tokens along `HostPort.parent` chains. Single-value
 * `request` / `watch` always resolve nearest-wins with no direction; multi
 * `requestAll` / `watchAll` order `bottomUp` (nearest-first, default) or
 * `topDown` (outermost-first), breaking same-scope ties by registration
 * order with depth measured in parent hops.
 *
 * `watch` / `watchAll` are cold resolve-once streams: a single value settles
 * on first emit, a multi value settles on the first non-empty snapshot, and
 * an empty snapshot never settles (`single first-emit / multi
 * first-non-empty; empty never settles`). Absence stays pending until a
 * wake-up source provides the token; aborting `signal` completes the stream
 * and drops the pending entry.
 */
export interface ScopeTransportPort {
    /**
     * Takes a synchronous snapshot: returns the nearest hit, or null on a
     * miss without waiting.
     *
     * @param token Token to resolve (string or private).
     * @param from Host starting the ancestor walk.
     * @param options Optional `subscribe` flag: P1 reservation only,
     * tolerated but never consumed in v0.1.0.
     * @returns The nearest resolution, or null when nothing matches.
     */
    request<T>(
        token: Token,
        from: HostPort,
        options?: { readonly subscribe?: boolean },
    ): ScopeResolution<T> | null
    /**
     * Takes a synchronous multi snapshot: 0..N matches, never null. An empty
     * array is a legal snapshot of the current moment and does not violate
     * the async first-non-empty rule.
     *
     * @param token Token to resolve (string or private).
     * @param from Host starting the ancestor walk.
     * @param options Optional direction (`bottomUp` default, `topDown`).
     * @returns Ordered resolutions, possibly empty.
     */
    requestAll<T>(
        token: Token,
        from: HostPort,
        options?: { readonly direction?: 'bottomUp' | 'topDown' },
    ): ReadonlyArray<ScopeResolution<T>>
    /**
     * Cold late-binding stream for a single value: resolves on first emit,
     * then completes. Absence stays pending until a wake-up provides the
     * token. Single values are always nearest-wins with no direction.
     *
     * @param token Token to resolve (string or private).
     * @param from Host starting the ancestor walk.
     * @param options Optional abort signal; abort completes the stream and
     * drops the pending entry.
     * @returns Cold observable emitting the first resolution, then completing.
     * @example
     * ```ts
     * import type { ScopeTransportPort } from './scope-transport.js'
     * import type { HostPort } from './host.js'
     *
     * const awaitTheme = (transport: ScopeTransportPort, from: HostPort): void => {
     *     transport.watch<string>('app:theme', from).subscribe((resolution) => {
     *         void resolution.value
     *     })
     * }
     * ```
     */
    watch<T>(
        token: Token,
        from: HostPort,
        options?: { readonly signal?: AbortSignal },
    ): Observable<ScopeResolution<T>>
    /**
     * Cold late-binding stream for multi values: settles on the first
     * non-empty snapshot, then completes; empty snapshots never emit and
     * never settle.
     *
     * @param token Token to resolve (string or private).
     * @param from Host starting the ancestor walk.
     * @param options Optional direction and abort signal; abort completes the
     * stream and drops the pending entry.
     * @returns Cold observable emitting the first non-empty snapshot, then
     * completing.
     */
    watchAll<T>(
        token: Token,
        from: HostPort,
        options?: { readonly direction?: 'bottomUp' | 'topDown', readonly signal?: AbortSignal },
    ): Observable<ReadonlyArray<ScopeResolution<T>>>
}

/**
 * Duck-typing probe for thenables: true when `value` carries a callable
 * `then`. Uses `typeof x.then === 'function'` and never `instanceof`, so
 * cross-realm promises and hand-rolled thenables both match while null,
 * primitives, and non-function `then` values are rejected without throwing.
 *
 * @param value Candidate value to test.
 * @returns True when `value` is promise-like.
 * @example
 * ```ts
 * import { isThenable } from './scope-transport.js'
 *
 * const settled = isThenable({ then: () => {} })
 * ```
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        return false
    }
    return typeof (value as { readonly then?: unknown }).then === 'function'
}
