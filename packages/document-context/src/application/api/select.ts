/**
 * State selection verbs: a hot stream projection plus a memoised synchronous
 * snapshot. The stream never filters; the snapshot caches the last
 * `(state, result)` pair per curried reader.
 *
 * Phase: runtime (application layer). The factory is pure: calling
 * `createSelection` performs no I/O and subscribes to nothing. `select$`
 * derives a hot Observable from the session store; `selectSync` reads the
 * current snapshot with per-reader memoisation. Side effects: none beyond
 * subscription management. Idempotency: repeated snapshot reads of an
 * unchanged state return the cached projection without recomputation.
 * Lifecycle: disposed sessions complete the stream immediately while
 * `selectSync` still answers with the last snapshot.
 */

import { map } from 'rxjs'
import type { Observable } from 'rxjs'
import { DocumentContextError } from '../../domain/index.js'
import type { MountSessionRecord, Session } from '../../domain/index.js'

/**
 * Structural application context consumed by selection: the facade-to-record
 * lookup only. Mirrors the frozen `ApplicationContext` subset this track
 * needs; `../context.js` (parallel track) is intentionally not imported so
 * this module typechecks standalone.
 */
export interface SelectionContext {
    /** Session facade to live record lookup. */
    readonly records: WeakMap<object, MountSessionRecord<Record<PropertyKey, unknown>>>
}

/**
 * Hot stream projection factory.
 *
 * Phase: runtime; the returned Observable is hot (backed by the session
 * store, new subscribers immediately receive the current projection). Purity:
 * projecting never mutates state; no filtering is applied, so every store
 * emission pushes (compose `distinctUntilChanged` at the call site when
 * needed). Side effects: subscription management only. Idempotency:
 * subscribing twice yields independent subscriptions. Lifecycle: disposed
 * sessions complete immediately.
 */
export interface SelectObservableFn {
    /**
     * Projects session state through a selector as a hot stream.
     *
     * @param selector Pure projection from state to the derived value.
     * @returns Data-last reader mapping a session to its projection stream.
     * @throws DocumentContextError with code `DISPOSED_SESSION` for unknown
     * session handles (thrown synchronously at call time).
     * @example
     * ```ts
     * import { createSelection } from './select.js'
     *
     * const { select$ } = createSelection(ctx)
     * select$((state: { count: number }) => state.count)(session).subscribe((count) => {
     *     console.log(count)
     * })
     * ```
     */
    <S extends Record<PropertyKey, unknown>, R>(
        selector: (state: S) => R,
    ): (session: Session<S, unknown>) => Observable<R>
}

/**
 * Memoised synchronous snapshot factory.
 *
 * Phase: runtime snapshot (second tier). Purity: pure read; each curried
 * reader keeps a `WeakMap` of last `(state, result)` pairs so repeat reads
 * of an unchanged snapshot never recompute. Side effects: none.
 * Idempotency: repeated reads agree. Lifecycle: disposed sessions answer
 * with the projection of the last snapshot.
 *
 * @deprecated Second-tier projection: not part of the stable contract and
 * subject to removal. Prefer `select$` for new code.
 */
export interface SelectSyncFn {
    /**
     * Projects the current session snapshot through a selector with memoisation.
     *
     * @param selector Pure projection from state to the derived value.
     * @returns Data-last reader mapping a session to its current projection.
     * @throws DocumentContextError with code `DISPOSED_SESSION` for unknown
     * session handles.
     * @example
     * ```ts
     * import { createSelection } from './select.js'
     *
     * const { selectSync } = createSelection(ctx)
     * const count = selectSync((state: { count: number }) => state.count)(session)
     * console.log(count)
     * ```
     */
    <S extends Record<PropertyKey, unknown>, R>(
        selector: (state: S) => R,
    ): (session: Session<S, unknown>) => R
}

/**
 * The selection verbs created by {@link createSelection}.
 */
export interface Selection {
    /** Hot stream projection (first tier). */
    readonly select$: SelectObservableFn
    /**
     * Memoised synchronous snapshot (second tier).
     *
     * @deprecated Not part of the stable contract; prefer `select$`.
     */
    readonly selectSync: SelectSyncFn
}

/**
 * Creates the selection verbs bound to one application context.
 *
 * Phase: pure factory; no DOM, no I/O, no listeners. Purity: creating the
 * verbs never reads any session. Side effects: only the returned verbs
 * subscribe or read, and only when called. Idempotency: creating twice
 * yields independent verb sets over the same context. Lifecycle: records
 * are observed live per call.
 *
 * @param ctx Selection context owning the facade-to-record lookup.
 * @returns The `{ select$, selectSync }` verbs.
 * @example
 * ```ts
 * import { createSelection } from './select.js'
 *
 * const { select$, selectSync } = createSelection(ctx)
 * const count$ = select$((state: { count: number }) => state.count)(session)
 * console.log(count$)
 * ```
 */
export const createSelection = (ctx: SelectionContext): Selection => {
    const select$ = (<S extends Record<PropertyKey, unknown>, R>(selector: (state: S) => R) =>
        (session: Session<S, unknown>): Observable<R> => {
            const record = ctx.records.get(session)
            if (record === undefined) {
                throw new DocumentContextError('DISPOSED_SESSION', {})
            }
            return record.sessionState.state$.pipe(map((state) => selector(state as unknown as S)))
        }) as SelectObservableFn
    const selectSync = (<S extends Record<PropertyKey, unknown>, R>(selector: (state: S) => R) => {
        const cache = new WeakMap<object, { readonly state: unknown, readonly result: unknown }>()
        return (session: Session<S, unknown>): R => {
            const record = ctx.records.get(session)
            if (record === undefined) {
                throw new DocumentContextError('DISPOSED_SESSION', {})
            }
            const state = record.sessionState.getSnapshot()
            const hit = cache.get(session)
            if (hit !== undefined && hit.state === state) {
                return hit.result as R
            }
            const result = selector(state as unknown as S)
            cache.set(session, { state, result })
            return result
        }
    }) as SelectSyncFn
    return { select$, selectSync }
}
