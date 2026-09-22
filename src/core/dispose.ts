import { Observable, EMPTY } from 'rxjs'
import { DocumentContextError } from './errors'
import {
    getInternalSession,
    removeElementSession
} from './session-internal'
import type { ISession } from './types'

/**
 * Tears down a mounted session and releases every resource it owns.
 *
 * Idempotent: disposing twice (or disposing a session with no internals) is a
 * safe no-op. The pipeline is: mark `isDisposed` and drop the element mapping
 * → `abortController.abort()` (cancelling `session.abortSignal` consumers) →
 * run blueprint `dispose` hooks LIFO → run mount/plugin cleanups LIFO →
 * dispatch a bubbling, composed `context-dispose` CustomEvent with
 * `detail: { sessionKey }`. Synchronous throws and async rejections inside
 * hooks or cleanups are caught and routed to the session error stream as
 * `DISPOSE_HOOK_ERROR` / `MOUNT_CLEANUP_ERROR` instead of propagating.
 *
 * After disposal, `update()` returns `false`, `subscribe()` returns an empty
 * unsubscribe, and `session.isDisposed` stays `true` permanently.
 *
 * @param session - Active `ISession` to tear down.
 * @returns `void`. No value, no promise; async cleanups settle in the
 * background.
 *
 * @example
 * ```ts
 * import { dispose, update } from '@sandlada/document-context'
 *
 * dispose(session)
 * console.log(session.isDisposed)
 * update({ count: 1 })(session) // false, silent no-op
 * ```
 */
export function dispose<S extends Record<PropertyKey, any>, Services>(
    session: ISession<S, Services>
): void {
    const internal = getInternalSession(session)
    if (!internal || internal.isDisposed) {
        return
    }

    internal.isDisposed = true
    removeElementSession(session.target)

    try {
        internal.abortController.abort()
    } catch (err) {
        // AbortController abort should not throw, but sandbox just in case
    }

    // 1. Run dispose hooks in LIFO order
    const disposeHooks = session.blueprint.hooks.filter((h) => h.event === 'dispose')
    for (let i = disposeHooks.length - 1; i >= 0; i--) {
        const hook = disposeHooks[i]
        if (hook) {
            try {
                const res = hook.handler(session)
                if (res && typeof res.then === 'function') {
                    res.catch((err: unknown) => {
                        internal.errorSubject.next(
                            new DocumentContextError({
                                code: 'DISPOSE_HOOK_ERROR',
                                message: err instanceof Error ? err.message : String(err),
                                details: { hook: 'dispose' }
                            })
                        )
                    })
                }
            } catch (err) {
                internal.errorSubject.next(
                    new DocumentContextError({
                        code: 'DISPOSE_HOOK_ERROR',
                        message: err instanceof Error ? err.message : String(err),
                        details: { hook: 'dispose' }
                    })
                )
            }
        }
    }

    // 2. Run mount cleanups in LIFO order
    for (let i = internal.cleanups.length - 1; i >= 0; i--) {
        const cleanup = internal.cleanups[i]
        if (cleanup) {
            try {
                const res = cleanup()
                if (res && typeof res.then === 'function') {
                    res.catch((err: unknown) => {
                        internal.errorSubject.next(
                            new DocumentContextError({
                                code: 'MOUNT_CLEANUP_ERROR',
                                message: err instanceof Error ? err.message : String(err),
                                details: { cleanupIndex: i }
                            })
                        )
                    })
                }
            } catch (err) {
                internal.errorSubject.next(
                    new DocumentContextError({
                        code: 'MOUNT_CLEANUP_ERROR',
                        message: err instanceof Error ? err.message : String(err),
                        details: { cleanupIndex: i }
                    })
                )
            }
        }
    }

    // 3. Dispatch native DOM context-dispose event
    try {
        const sessionKey = session.target.getAttribute('data-context-key') ?? undefined
        session.target.dispatchEvent(
            new CustomEvent('context-dispose', {
                bubbles: true,
                composed: true,
                detail: { sessionKey }
            })
        )
    } catch (err) {
        // Suppress event dispatch failures on disposed node
    }
}

/**
 * Returns the non-fatal runtime error stream for a session.
 *
 * The stream is a `ReplaySubject<DocumentContextError>(20)` held on session
 * internals, so late subscribers replay up to the last 20 errors. Sources
 * include mount plugin/hook failures, dispose cleanup failures, storage parse
 * failures, and bridge errors. Fatal DI throws (`UnknownServiceError`,
 * `CircularDependencyError`) still throw synchronously at the call site and
 * are not duplicated here.
 *
 * Exposes only the `Observable` interface; the underlying subject stays
 * encapsulated and RxJS never leaks into the public API beyond this type.
 *
 * @param session - `ISession` whose errors should be observed.
 * @returns An `Observable<DocumentContextError>`. Sessions with no internals
 * yield `EMPTY` (completes immediately, emits nothing).
 *
 * @example
 * ```ts
 * import { readErrorStream } from '@sandlada/document-context'
 *
 * const sub = readErrorStream(session).subscribe((err) => {
 *     console.error(`[${err.code}]`, err.message, err.resolutionGuide)
 * })
 * ```
 */
export function readErrorStream<S extends Record<PropertyKey, any>, Services>(
    session: ISession<S, Services>
): Observable<DocumentContextError> {
    const internal = getInternalSession(session)
    if (!internal) {
        return EMPTY
    }
    return internal.errorSubject.asObservable()
}
