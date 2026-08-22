import { Observable, EMPTY } from 'rxjs'
import { DocumentContextError } from './errors'
import {
    getInternalSession,
    removeElementSession
} from './session-internal'
import type { ISession } from './types'

/**
 * Disposes a mounted session, releases subscriptions, aborts signals, and cleans up resources in LIFO order.
 *
 * @param session The active ISession to tear down.
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
 * Returns an Observable stream of non-fatal runtime errors associated with the session.
 *
 * @param session The ISession instance.
 * @returns Observable of DocumentContextError.
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
