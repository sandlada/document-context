/**
 * The centralized DOM observer.
 *
 * One `MutationObserver` per document watches every host that needs connectivity facts. The
 * re-check runs on the scheduler, so a node that is moved inside the document is never mistaken
 * for a disconnect.
 */

import type { SchedulerPort } from '../../domain/ports/scheduler'

export interface DomObserver {
    /**
     * Watch an element.
     *
     * @param element - The element to watch.
     * @param listener - Called when the connectivity of the element changes.
     * @returns A function that stops watching.
     */
    observe(element: Element, listener: (connected: boolean, owner?: unknown) => void): () => void
    /**
     * Watch parent changes that are not disconnects.
     *
     * @param element - The element to watch.
     * @param listener - Called when the element moves inside a document.
     * @returns A function that stops watching.
     */
    observeStructure(element: Element, listener: () => void): () => void
    /** Stop observing and release the underlying `MutationObserver`. */
    release(): void
}

interface Watched {
    connected: boolean
    ownerDocument: Document
    parent: ParentNode | null
    readonly listeners: Set<(connected: boolean, owner?: unknown) => void>
    readonly structureListeners: Set<() => void>
}

/**
 * Create a centralized observer.
 *
 * @param document - The document to observe.
 * @param scheduler - The scheduler used for the re-check.
 * @returns The observer.
 */
export function createDomObserver(document: Document, scheduler: SchedulerPort): DomObserver {
    const watched = new Map<Element, Watched>()
    const observers = new Map<Document, MutationObserver>()
    let scheduled = false

    const ensureObserverFor = (doc: Document): void => {
        if (!doc || observers.has(doc)) {
            return
        }
        const observer = new MutationObserver(() => {
            if (scheduled) {
                return
            }
            scheduled = true
            scheduler.microtask(recheck)
        })
        try {
            observer.observe(doc, { childList: true, subtree: true })
            observers.set(doc, observer)
        } catch {
            // Some exotic documents might fail
        }
    }

    const pruneObservers = (): void => {
        const activeDocs = new Set<Document>([document])
        for (const entry of watched.values()) {
            activeDocs.add(entry.ownerDocument)
        }
        for (const [doc, obs] of [...observers.entries()]) {
            if (!activeDocs.has(doc)) {
                obs.disconnect()
                observers.delete(doc)
            }
        }
    }

    const recheck = (): void => {
        scheduled = false
        for (const [element, entry] of [...watched.entries()]) {
            const connected = element.isConnected
            const currentDoc = element.ownerDocument
            const docChanged = currentDoc !== entry.ownerDocument
            const parent = element.parentNode
            const parentChanged = parent !== entry.parent
            entry.parent = parent
            if (docChanged) {
                entry.ownerDocument = currentDoc
                ensureObserverFor(currentDoc)
            }
            if (connected !== entry.connected || docChanged) {
                entry.connected = connected
                for (const listener of [...entry.listeners]) {
                    listener(connected, docChanged ? currentDoc : undefined)
                }
            }
            if (parentChanged) {
                for (const listener of [...entry.structureListeners]) {
                    listener()
                }
            }
        }
        pruneObservers()
    }

    const releaseEntry = (element: Element): void => {
        const current = watched.get(element)
        if (current === undefined) {
            return
        }
        if (current.listeners.size === 0 && current.structureListeners.size === 0) {
            watched.delete(element)
        }
        if (watched.size === 0) {
            for (const obs of observers.values()) {
                obs.disconnect()
            }
            observers.clear()
        } else {
            pruneObservers()
        }
    }

    const ensure = (element: Element): Watched => {
        let entry = watched.get(element)
        if (entry === undefined) {
            entry = {
                connected: element.isConnected,
                ownerDocument: element.ownerDocument,
                parent: element.parentNode,
                listeners: new Set(),
                structureListeners: new Set(),
            }
            watched.set(element, entry)
            ensureObserverFor(element.ownerDocument)
        }
        return entry
    }

    return {
        observe(element: Element, listener: (connected: boolean, owner?: unknown) => void): () => void {
            const entry = ensure(element)
            entry.listeners.add(listener)
            return () => {
                entry.listeners.delete(listener)
                releaseEntry(element)
            }
        },
        observeStructure(element: Element, listener: () => void): () => void {
            const entry = ensure(element)
            entry.structureListeners.add(listener)
            return () => {
                entry.structureListeners.delete(listener)
                releaseEntry(element)
            }
        },
        release(): void {
            for (const obs of observers.values()) {
                obs.disconnect()
            }
            observers.clear()
            watched.clear()
        },
    }
}
