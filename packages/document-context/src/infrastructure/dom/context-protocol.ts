/**
 * The Context Protocol event names and shapes.
 *
 * These names and the `detail` shape are a **public contract**: any implementation that dispatches
 * and listens to the same events can resolve dependencies with this library.
 */

import type { ContextRequestDetail } from '../../domain/ports/scope-transport'

/** The event a consumer dispatches when it needs a provider. */
export const CONTEXT_REQUEST_EVENT = 'context-request'
/** The event a provider dispatches after its session became `active`. */
export const CONTEXT_MOUNT_EVENT = 'context-mount'
/** The event a provider dispatches after its session was disposed. */
export const CONTEXT_DISPOSE_EVENT = 'context-dispose'

/** The `detail` of a `context-mount` or `context-dispose` event. */
export interface ContextAnnouncementDetail {
    /** The keyed identity of the session, or `null` for anonymous sessions. */
    readonly context: string | null
}

/**
 * Dispatch a `context-request` from an element.
 *
 * @param element - The element the request originates from.
 * @param detail - The request detail.
 */
export function dispatchContextRequest(element: Element, detail: ContextRequestDetail): void {
    element.dispatchEvent(
        new CustomEvent(CONTEXT_REQUEST_EVENT, {
            bubbles: true,
            composed: true,
            cancelable: false,
            detail,
        }),
    )
}

/**
 * Listen for `context-request` events on an element.
 *
 * @param element - The element to listen on.
 * @param handler - The handler.
 * @returns A function that removes the listener.
 */
export function listenContextRequest(
    element: Element,
    handler: (detail: ContextRequestDetail) => void,
): () => void {
    const listener = (event: Event): void => {
        const detail = (event as CustomEvent<ContextRequestDetail>).detail
        if (detail === undefined || detail === null) {
            return
        }
        handler(detail)
    }
    element.addEventListener(CONTEXT_REQUEST_EVENT, listener)
    return () => {
        element.removeEventListener(CONTEXT_REQUEST_EVENT, listener)
    }
}

/**
 * Dispatch a `context-mount` or `context-dispose` event on an element.
 *
 * @param element - The element to dispatch on.
 * @param type - Which announcement to publish.
 * @param token - The keyed identity of the session, or `null`.
 */
export function dispatchContextAnnouncement(
    element: Element,
    type: 'mount' | 'dispose',
    token: string | null,
): void {
    const name = type === 'mount' ? CONTEXT_MOUNT_EVENT : CONTEXT_DISPOSE_EVENT
    element.dispatchEvent(
        new CustomEvent(name, {
            bubbles: true,
            composed: true,
            cancelable: false,
            detail: { context: token } satisfies ContextAnnouncementDetail,
        }),
    )
}
