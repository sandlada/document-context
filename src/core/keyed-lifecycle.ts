import { DocumentContextError } from './errors'
import { dispose } from './dispose'
import { rebindHostActivations } from './host-activation'
import { applyKeyProjection } from './session-key'
import {
    getInternalSession,
    removeElementSession,
    setElementSession
} from './session-internal'
import type { ISession } from './types'

/**
 * Parks a keyed session into the suspended state after its host disconnected.
 *
 * Pipeline: mark `isSuspended` → run blueprint `suspend` hooks (sandboxed) →
 * dispatch `context-suspend` with `{ sessionKey, ttl }` → drop the element
 * mapping (the session is no longer reachable through the detached host) →
 * arm the TTL timer that disposes the session if it is still suspended and
 * disconnected when the timer fires.
 *
 * Disposal policy: anonymous sessions (no resolved key) are ignored here and
 * `suspensionTtlMs === 0` disposes immediately without entering the suspended
 * state. When `force` is set (hot transfer via `onConflict: 'evict'`), the
 * TTL-0 disposal and the timer are skipped because an immediate resuscitation
 * follows.
 *
 * @param session - Live keyed session whose host just disconnected.
 * @param force - Skip TTL disposal and timer scheduling (evict path).
 * @returns `true` when the session is parked in the suspended state, `false`
 * when it was disposed immediately or was already suspended/disposed/anonymous.
 */
export function suspendSession(session: ISession<any, any>, force: boolean = false): boolean {
    const internal = getInternalSession(session)
    if (!internal || internal.isDisposed || internal.isSuspended) {
        return false
    }
    if (internal.key === undefined) {
        return false
    }
    if (!force && internal.suspensionTtlMs === 0) {
        dispose(session)
        return false
    }

    internal.isSuspended = true

    const suspendHooks = session.blueprint.hooks.filter((h) => h.event === 'suspend')
    for (const hook of suspendHooks) {
        try {
            hook.handler(session)
        } catch (err) {
            internal.errorSubject.next(
                new DocumentContextError({
                    code: 'SUSPEND_HOOK_ERROR',
                    message: err instanceof Error ? err.message : String(err),
                    details: { hook: 'suspend' }
                })
            )
        }
    }

    try {
        internal.target.dispatchEvent(
            new CustomEvent('context-suspend', {
                bubbles: true,
                composed: true,
                detail: { sessionKey: internal.key, ttl: internal.suspensionTtlMs }
            })
        )
    } catch {
        // Suppress dispatch failures on detached nodes
    }

    removeElementSession(internal.target)

    if (!force && internal.suspensionTtlMs !== Infinity) {
        internal.suspensionTimer = setTimeout(() => {
            internal.suspensionTimer = undefined
            if (internal.isSuspended && !internal.target.isConnected) {
                dispose(session)
            }
        }, internal.suspensionTtlMs)
    }

    return true
}

/**
 * Reattaches a keyed session to a (new) host element — the resuscitation
 * procedure shared by mount-driven recovery, the manual
 * `resuscitateKeyedSession()` escape hatch, and observer-detected same-node
 * reconnection.
 *
 * Pipeline: clear the suspended flag and cancel the TTL timer → repoint the
 * internal target and the element mapping → normalize the `data-context-key`
 * projection on the new host → rebind every host activation (which performs
 * the full state-to-DOM projection through the bridge) → run blueprint
 * `resuscitate` hooks `(session, newTarget)` → dispatch
 * `context-resuscitate` with `{ session, newTarget }`.
 *
 * `mount` hooks are never re-run and `context-mount` is never re-dispatched.
 * Safe to call on a session that was connected but never suspended (mount
 * takeover of a disconnected host); no-ops on disposed or unknown sessions.
 *
 * @param session - Session to reattach.
 * @param newTarget - Replacement host element.
 * @returns `void`.
 */
export function resuscitateSession(session: ISession<any, any>, newTarget: HTMLElement): void {
    const internal = getInternalSession(session)
    if (!internal || internal.isDisposed) {
        return
    }

    const previousTarget = internal.target

    internal.isSuspended = false
    if (internal.suspensionTimer !== undefined) {
        clearTimeout(internal.suspensionTimer)
        internal.suspensionTimer = undefined
    }

    internal.target = newTarget
    if (previousTarget !== newTarget) {
        removeElementSession(previousTarget)
    }
    setElementSession(newTarget, session)

    if (internal.key !== undefined) {
        applyKeyProjection(newTarget, internal.key)
    }

    // Host-scoped integrations (bridge projection, responder, GC tracking)
    rebindHostActivations(session, newTarget)

    const resuscitateHooks = session.blueprint.hooks.filter((h) => h.event === 'resuscitate')
    for (const hook of resuscitateHooks) {
        try {
            hook.handler(session, newTarget)
        } catch (err) {
            internal.errorSubject.next(
                new DocumentContextError({
                    code: 'RESUSCITATE_HOOK_ERROR',
                    message: err instanceof Error ? err.message : String(err),
                    details: { hook: 'resuscitate' }
                })
            )
        }
    }

    try {
        newTarget.dispatchEvent(
            new CustomEvent('context-resuscitate', {
                bubbles: true,
                composed: true,
                detail: { session, newTarget }
            })
        )
    } catch {
        // Suppress event dispatch failures
    }
}
