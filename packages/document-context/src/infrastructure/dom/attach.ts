/**
 * Session lifecycle announcements: the normative `context-mount` /
 * `context-dispose` `CustomEvent` channel (09b §9b.5).
 *
 * This module is infrastructure: it owns no state and answers no resolution.
 * `bindSessionAnnouncements` subscribes one session's `lifecycle$` and
 * projects every `Mounted` entry (`mounted`, including `resuscitated`) and
 * the terminal `disposed` onto the host's native node as a bubbling,
 * composed, non-cancelable `CustomEvent`. `suspended` and `adopted` facts
 * stay internal (no native event is reserved for them in v0.1.0).
 *
 * The event detail carries `{ token }` only: `providedTokens` is absent by
 * construction (the domain `Session` handle exposes no provider list), so
 * cross-bundle receivers take the whole-document fallback path — still
 * correct per 09b §9b.6. Announcement failures never break the session: a
 * missing `dispatchEvent` (SSR nullHost), an unreadable native node, a
 * missing `CustomEvent` global, or a throwing dispatch all skip silently.
 */
import type { HostPort } from '../../domain/ports/host.js'
import type { Session } from '../../domain/model/session.js'

/**
 * Normative mount announcement name: dispatched on the host whenever a
 * session enters `Mounted`, first mount and resuscitation alike. Public
 * cross-bundle contract (`bubbles: true, composed: true`).
 */
export const CONTEXT_MOUNT_EVENT = 'context-mount'

/**
 * Normative dispose announcement name: dispatched on the host exactly once
 * when a session reaches terminal `Disposed`. Public cross-bundle contract
 * (`bubbles: true, composed: true`).
 */
export const CONTEXT_DISPOSE_EVENT = 'context-dispose'

const readNative = (host: HostPort): unknown => {
    try {
        return host.native()
    } catch {
        return null
    }
}

/**
 * Binds session lifecycle announcements for one session. Mount-execution
 * side effect (one `lifecycle$` subscription); the returned unsubscribe is
 * idempotent. Binding is call-once per session: the composition root wires
 * it at mount time, before hydration settles, so no `Mounted` entry is
 * missed.
 *
 * @param session Session whose `mounted` / `resuscitated` entries announce
 * `context-mount` and whose `disposed` entry announces `context-dispose`.
 * @returns Idempotent unsubscribe stopping all announcements.
 * @example
 * ```ts
 * import { bindSessionAnnouncements } from './attach.js'
 *
 * const stopAnnouncing = bindSessionAnnouncements(session)
 * stopAnnouncing()
 * ```
 */
export function bindSessionAnnouncements(session: Session): () => void {
    const subscription = session.lifecycle$.subscribe((event) => {
        const name = event.type === 'disposed'
            ? CONTEXT_DISPOSE_EVENT
            : event.type === 'mounted' || event.type === 'resuscitated'
                ? CONTEXT_MOUNT_EVENT
                : null
        if (name === null) {
            return
        }
        if (typeof CustomEvent !== 'function') {
            return
        }
        const native = readNative(session.host)
        if (typeof native !== 'object' || native === null) {
            return
        }
        const dispatchEvent = (native as { readonly dispatchEvent?: unknown }).dispatchEvent
        if (typeof dispatchEvent !== 'function') {
            return
        }
        try {
            (dispatchEvent as (event: Event) => void).call(
                native,
                new CustomEvent(name, {
                    detail: { token: session.token },
                    bubbles: true,
                    composed: true,
                    cancelable: false,
                }),
            )
        } catch {
            // Announcements are best-effort: the session already transitioned,
            // so a throwing node must never break lifecycle flow.
        }
    })
    return () => subscription.unsubscribe()
}
