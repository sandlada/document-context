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
 * Initializes and starts the centralized document-level MutationObserver for automatic GC.
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
 * Stops and disconnects the centralized root observer for the specified document.
 */
export function stopRootObserver(doc: Document = document): void {
    const observer = docObservers.get(doc)
    if (observer) {
        observer.disconnect()
        docObservers.delete(doc)
    }
}

/**
 * Registers an HTMLElement and its active ISession with the centralized GC tracker.
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
 * Migrates a session to a new host document (e.g. iframe / Picture-in-Picture window).
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
