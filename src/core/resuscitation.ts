import {
    getInternalSession,
    setElementSession
} from './session-internal'
import type { ISession } from './types'

const keyedSessionMap = new Map<string, ISession<any, any>>()

/**
 * Registers a live session under a `data-context-key` for suspend/resuscitate.
 *
 * Keyed sessions survive host detachment: instead of immediate disposal, the
 * observer parks them in the suspended state for a 50ms TTL during which
 * `resuscitateKeyedSession()` can reattach them to a new host with state
 * intact. Overwrites any previous session under the same key.
 *
 * @param key - Value of the host `data-context-key` attribute.
 * @param session - Live session to park under the key.
 * @returns `void`.
 *
 * @example
 * ```ts
 * import { registerKeyedSession } from '@sandlada/document-context'
 *
 * registerKeyedSession('cart-panel', session)
 * ```
 */
export function registerKeyedSession(
    key: string,
    session: ISession<any, any>
): void {
    keyedSessionMap.set(key, session)
}

/**
 * Looks up the live session parked under a `data-context-key`.
 *
 * Returns the registered session even while it is suspended (that is the
 * resuscitation window). Callers must still check `session.isDisposed`,
 * because expired or explicitly disposed sessions stay mapped until the TTL
 * timer or `unregisterKeyedSession()` clears them.
 *
 * @param key - Value of the `data-context-key` attribute.
 * @returns The parked `ISession`, or `undefined` when no session was
 * registered under the key.
 *
 * @example
 * ```ts
 * import { findKeyedSession } from '@sandlada/document-context'
 *
 * const existing = findKeyedSession('cart-panel')
 * if (existing && !existing.isDisposed) {
 *     console.log('reusing suspended session')
 * }
 * ```
 */
export function findKeyedSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    key: string
): ISession<S, any> | undefined {
    return keyedSessionMap.get(key)
}

/**
 * Removes the session parked under a `data-context-key` without disposing it.
 *
 * Use when a keyed host is permanently retired and its suspended session
 * should no longer be resuscitable. Safe to call for unknown keys (no-op).
 *
 * @param key - Value of the `data-context-key` attribute.
 * @returns `void`.
 *
 * @example
 * ```ts
 * import { unregisterKeyedSession } from '@sandlada/document-context'
 *
 * unregisterKeyedSession('cart-panel')
 * ```
 */
export function unregisterKeyedSession(key: string): void {
    keyedSessionMap.delete(key)
}

/**
 * Reattaches a suspended keyed session to a new host element (resuscitation).
 *
 * Clears the suspended flag, repoints internal `target` at `newTarget`,
 * re-caches the session under the new element, replays the queued dirty
 * updates accumulated via `update()` during suspension (in order, then emits
 * once), runs blueprint `resuscitate` hooks as `(session, newTarget)`, and
 * dispatches a bubbling, composed `context-resuscitate` CustomEvent with
 * `detail: { session, newTarget }`. Hook throws are sandboxed.
 *
 * Returns `undefined` when no session is registered under `key`, when the
 * registered session is disposed, or when its internals are gone.
 *
 * @param key - `data-context-key` identifier the session was parked under.
 * @param newTarget - New physical host element, typically the replacement node
 * carrying the same key.
 * @returns The resuscitated `ISession`, or `undefined` when nothing
 * resuscitable was found.
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
    const session = findKeyedSession<S>(key)
    if (!session || session.isDisposed) {
        return undefined
    }

    const internal = getInternalSession(session)
    if (!internal) {
        return undefined
    }

    internal.isSuspended = false
    internal.target = newTarget
    setElementSession(newTarget, session)

    // Flush dirty queue
    if (internal.dirtyQueue.length > 0) {
        let state = internal.stateSubject.getValue()
        for (const updater of internal.dirtyQueue) {
            const partial = updater(state)
            state = { ...state, ...partial }
        }
        internal.dirtyQueue = []
        internal.stateSubject.next(state)
    }

    // Trigger resuscitate hooks
    const resuscitateHooks = session.blueprint.hooks.filter(
        (h) => h.event === 'resuscitate'
    )
    for (const hook of resuscitateHooks) {
        try {
            hook.handler(session, newTarget)
        } catch {
            // Sandbox
        }
    }

    // Dispatch native context-resuscitate DOM CustomEvent
    try {
        newTarget.dispatchEvent(
            new CustomEvent('context-resuscitate', {
                bubbles: true,
                composed: true,
                detail: { session, newTarget }
            })
        )
    } catch {
        // Suppress
    }

    return session
}
