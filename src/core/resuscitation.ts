import {
    getInternalSession,
    setElementSession
} from './session-internal'
import type { ISession } from './types'

const keyedSessionMap = new Map<string, ISession<any, any>>()

export function registerKeyedSession(
    key: string,
    session: ISession<any, any>
): void {
    keyedSessionMap.set(key, session)
}

export function findKeyedSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    key: string
): ISession<S, any> | undefined {
    return keyedSessionMap.get(key)
}

export function unregisterKeyedSession(key: string): void {
    keyedSessionMap.delete(key)
}

/**
 * Resuscitates a suspended keyed session by transferring it to a new host element.
 *
 * @param key The data-context-key string identifier.
 * @param newTarget The new physical HTMLElement.
 * @returns The resuscitated ISession, or undefined if no session was registered.
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
