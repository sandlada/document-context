import { resuscitateSession } from './keyed-lifecycle'
import {
    lookupKeyedSession,
    unregisterKeyedSessionEntry
} from './keyed-registry'
import { getInternalSession } from './session-internal'
import type { ISession } from './types'

/**
 * Looks up the live session parked under a keyed identity.
 *
 * Registrations are automatic: `mount(bp, { key })` registers on creation and
 * the entry survives host disconnection while the session is suspended. The
 * result is per-document; pass the owning `Document` explicitly for iframe
 * documents. The returned session may already be suspended or disposed —
 * callers must check `session.isDisposed` (and `session.isSuspended` when the
 * distinction matters).
 *
 * @param key - Resolved session key (`options.key` or `data-context-key`).
 * @param document - Owning document. Defaults to the global `document`.
 * @returns The parked `ISession`, or `undefined` when no session is
 * registered under the key.
 *
 * @example
 * ```ts
 * import { findKeyedSession } from '@sandlada/document-context'
 *
 * const existing = findKeyedSession('cart-panel')
 * if (existing && !existing.isDisposed && existing.isSuspended) {
 *     console.log('suspended session awaiting a new host')
 * }
 * ```
 */
export function findKeyedSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    key: string,
    document: Document = globalThis.document
): ISession<S, any> | undefined {
    return lookupKeyedSession<S>(document, key)
}

/**
 * Retires a keyed identity without disposing the session.
 *
 * Removes the registry entry and clears the session's resolved key, so a later
 * host disconnection follows the anonymous deterministic-disposal path and no
 * resuscitation can occur. Use when a keyed host is permanently retired while
 * the session itself stays alive; for full teardown prefer `dispose()`.
 * Safe to call for unknown keys (no-op).
 *
 * @param key - Resolved session key to retire.
 * @param document - Owning document. Defaults to the global `document`.
 * @returns `void`.
 *
 * @example
 * ```ts
 * import { unregisterKeyedSession } from '@sandlada/document-context'
 *
 * unregisterKeyedSession('cart-panel')
 * ```
 */
export function unregisterKeyedSession(
    key: string,
    document: Document = globalThis.document
): void {
    const session = lookupKeyedSession(document, key)
    if (session) {
        const internal = getInternalSession(session)
        if (internal) {
            internal.key = undefined
        }
    }
    unregisterKeyedSessionEntry(document, key, session ?? undefined)
}

/**
 * Reattaches a suspended (or disconnected) keyed session to a replacement
 * host element — the manual escape hatch of the automatic resuscitation
 * pipeline.
 *
 * Runs the shared resuscitation procedure: clears suspension, cancels the TTL
 * timer, repoints the target, rebinds host activations with a full state-to-DOM
 * projection, runs `resuscitate` hooks, and dispatches `context-resuscitate`.
 * Refuses to steal a session whose current host is still connected (use
 * `onConflict: 'evict'` at the mount boundary for intentional hot transfers).
 *
 * @param key - Resolved session key the session was parked under.
 * @param newTarget - Replacement host element; its `ownerDocument` selects the
 * registry.
 * @returns The resuscitated `ISession`, or `undefined` when nothing
 * resuscitable was found or the current host is still connected.
 *
 * @example
 * ```ts
 * import { resuscitateKeyedSession } from '@sandlada/document-context'
 *
 * const replacement = document.querySelector('[data-context-key="cart-panel"]') as HTMLElement
 * const session = resuscitateKeyedSession('cart-panel', replacement)
 * ```
 */
export function resuscitateKeyedSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    key: string,
    newTarget: HTMLElement
): ISession<S, any> | undefined {
    const document = newTarget.ownerDocument
    const session = lookupKeyedSession<S>(document, key)
    if (!session || session.isDisposed) {
        return undefined
    }

    const internal = getInternalSession(session)
    if (!internal) {
        return undefined
    }

    if (!internal.isSuspended && internal.target.isConnected) {
        return undefined
    }

    resuscitateSession(session, newTarget)
    return session
}
