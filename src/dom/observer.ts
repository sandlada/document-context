import { dispose } from '../core/dispose'
import { getInternalSession } from '../core/session-internal'
import type { ISession } from '../core/types'

interface ITrackedSessionItem {
    elementRef: WeakRef<HTMLElement>
    sessionRef: WeakRef<ISession<any, any>>
}

const trackedSessions = new Set<ITrackedSessionItem>()
const docObservers = new WeakMap<Document, MutationObserver>()

// FinalizationRegistry as fallback GC cleanup mechanism
const finalizationRegistry =
    typeof FinalizationRegistry !== 'undefined'
        ? new FinalizationRegistry<ISession<any, any>>((session) => {
              if (session && !session.isDisposed) {
                  try {
                      dispose(session)
                  } catch {
                      // Sandbox
                  }
              }
          })
        : null

function processDisconnections(doc: Document) {
    queueMicrotask(() => {
        for (const item of Array.from(trackedSessions)) {
            const el = item.elementRef.deref()
            const session = item.sessionRef.deref()

            if (!el || !session) {
                trackedSessions.delete(item)
                continue
            }

            if (!el.isConnected) {
                if (session.isDisposed) {
                    trackedSessions.delete(item)
                    continue
                }

                const key = el.getAttribute('data-context-key')
                if (key) {
                    // Keyed session enters Suspended state
                    const internal = getInternalSession(session)
                    if (internal && !internal.isSuspended) {
                        internal.isSuspended = true

                        // Trigger suspend hooks
                        const suspendHooks = session.blueprint.hooks.filter(
                            (h) => h.event === 'suspend'
                        )
                        for (const hook of suspendHooks) {
                            try {
                                hook.handler(session)
                            } catch {
                                // Sandbox
                            }
                        }

                        // Dispatch context-suspend event
                        try {
                            el.dispatchEvent(
                                new CustomEvent('context-suspend', {
                                    bubbles: true,
                                    composed: true,
                                    detail: { sessionKey: key, ttl: 50 }
                                })
                            )
                        } catch {
                            // Suppress
                        }

                        // 50ms TTL timer before permanent disposal
                        setTimeout(() => {
                            if (internal.isSuspended && !el.isConnected) {
                                dispose(session)
                                trackedSessions.delete(item)
                            }
                        }, 50)
                    }
                } else {
                    // Anonymous session: deterministic immediate disposal
                    dispose(session)
                    trackedSessions.delete(item)
                }
            }
        }
    })
}

/**
 * Starts (or reuses) the centralized document-level `MutationObserver` that
 * drives automatic session GC.
 *
 * One observer per `Document`, observing `body ?? documentElement` with
 * `{ childList: true, subtree: true }`. Removal batches are funneled into
 * `processDisconnections()`, which runs inside `queueMicrotask` so a
 * disconnect followed by a same-task reparent is treated as a move, not a
 * destroy. Safe to call repeatedly; returns the cached observer.
 *
 * @param doc - Document to observe. Defaults to the global `document`.
 * @returns The active `MutationObserver` for the document.
 *
 * @example
 * ```ts
 * import { startRootObserver, stopRootObserver } from '@sandlada/document-context'
 *
 * const observer = startRootObserver(document)
 * stopRootObserver(document)
 * ```
 */
export function startRootObserver(doc: Document = document): MutationObserver {
    let observer = docObservers.get(doc)
    if (observer) {
        return observer
    }

    observer = new MutationObserver((mutations) => {
        let hasRemovals = false
        for (const mutation of mutations) {
            if (mutation.removedNodes.length > 0) {
                hasRemovals = true
                break
            }
        }
        if (hasRemovals) {
            processDisconnections(doc)
        }
    })

    const targetNode = doc.body ?? doc.documentElement ?? doc
    if (targetNode) {
        observer.observe(targetNode, {
            childList: true,
            subtree: true
        })
    }

    docObservers.set(doc, observer)
    return observer
}

/**
 * Disconnects and drops the centralized observer for a document.
 *
 * Tracked sessions are not disposed by this call; it only stops future
 * removal detection (used when a session migrates documents via
 * `adoptSessionToDocument`). Unknown documents are a safe no-op.
 *
 * @param doc - Document whose observer should stop. Defaults to the global
 * `document`.
 * @returns `void`.
 *
 * @example
 * ```ts
 * import { stopRootObserver } from '@sandlada/document-context'
 *
 * stopRootObserver(document)
 * ```
 */
export function stopRootObserver(doc: Document = document): void {
    const observer = docObservers.get(doc)
    if (observer) {
        observer.disconnect()
        docObservers.delete(doc)
    }
}

/**
 * Registers a host element and its session with the centralized GC tracker.
 *
 * Auto-invoked by the DOM mount plugin on every `mount()`; also ensures the
 * owner document's root observer is running and registers a
 * `FinalizationRegistry` fallback that disposes the session if the element is
 * garbage-collected without a removal record. Entries hold both sides by
 * `WeakRef`, so tracking itself never leaks.
 *
 * GC policy on disconnect: hosts without `data-context-key` dispose
 * deterministically on the next microtask; keyed hosts enter the suspended
 * state (suspend hooks + `context-suspend` event with
 * `detail: { sessionKey, ttl: 50 }`) and dispose only if still disconnected
 * after the 50ms TTL.
 *
 * @param element - Mounted host element.
 * @param session - Live session bound to the element.
 * @returns `void`.
 *
 * @example
 * ```ts
 * import { trackElementForGC } from '@sandlada/document-context'
 *
 * trackElementForGC(element, session)
 * ```
 */
export function trackElementForGC(
    element: HTMLElement,
    session: ISession<any, any>
): void {
    const doc = element.ownerDocument ?? (typeof document !== 'undefined' ? document : null)
    if (doc) {
        startRootObserver(doc)
    }

    trackedSessions.add({
        elementRef: new WeakRef(element),
        sessionRef: new WeakRef(session)
    })

    if (finalizationRegistry) {
        finalizationRegistry.register(element, session, session)
    }
}

/**
 * Migrates a session to a new host document (iframe, popup, or
 * Picture-in-Picture window).
 *
 * Stops the old document's root observer when it differs, starts the new
 * one, runs blueprint `adopt` hooks as `(session, newDocument)`, and
 * dispatches a bubbling, composed `context-adopt` CustomEvent with
 * `detail: { newDocument }`. Hook and dispatch failures are sandboxed. The
 * session target element itself is not moved; move or adopt the node first,
 * then call this to rewire observation.
 *
 * @param session - Live session to migrate.
 * @param newDocument - Destination document now hosting the element.
 * @returns `void`.
 *
 * @example
 * ```ts
 * import { adoptSessionToDocument } from '@sandlada/document-context'
 *
 * const popup = window.open('', '_blank')!
 * popup.document.body.appendChild(session.target)
 * adoptSessionToDocument(session, popup.document)
 * ```
 */
export function adoptSessionToDocument(
    session: ISession<any, any>,
    newDocument: Document
): void {
    const el = session.target
    const oldDoc = el.ownerDocument
    if (oldDoc && oldDoc !== newDocument) {
        stopRootObserver(oldDoc)
    }

    startRootObserver(newDocument)

    // Trigger adopt hooks
    const adoptHooks = session.blueprint.hooks.filter((h) => h.event === 'adopt')
    for (const hook of adoptHooks) {
        try {
            hook.handler(session, newDocument)
        } catch {
            // Sandbox
        }
    }

    try {
        el.dispatchEvent(
            new CustomEvent('context-adopt', {
                bubbles: true,
                composed: true,
                detail: { newDocument }
            })
        )
    } catch {
        // Suppress
    }
}
