/**
 * The DOM host adapter.
 *
 * The adapter normalizes elements into hosts, answers connectivity questions through a centralized
 * observer and stores the keyed identity in the `data-context-key` attribute.
 */

import { DocumentContextError } from '../../domain/model/errors'
import { validateTokenName } from '../../domain/model/token'
import type { Host, HostEventListener, HostListenerOptions } from '../../domain/model/session'
import type { ConnectivityPort, HostAdapter, TokensPort } from '../../domain/ports/host'
import type { SchedulerPort } from '../../domain/ports/scheduler'
import { createDomObserver, type DomObserver } from './observer'
import { createDomScopeTransport, isElement, type DomScopeTransport } from './scope-transport'
import { composedParent } from './session-stream'

/** The attribute that stores the keyed identity of a host. */
export const KEYED_IDENTITY_ATTRIBUTE = 'data-context-key'

/** A host backed by a DOM element. */
export interface DomHost extends Host<Element> {
    /** The element this host stands for. */
    readonly element: Element
}

/** The DOM host adapter. */
export interface DomHostAdapter extends HostAdapter<DomHost, Element> {
    /** The DOM scope transport. */
    readonly scope: DomScopeTransport
    /** The centralized observer. */
    readonly observer: DomObserver
    /**
     * The host of an element.
     *
     * @param element - The element.
     * @returns The stable host handle.
     */
    hostOf(element: Element): DomHost
    /** Release the observer and the listeners of the adapter. */
    release(): void
}

/**
 * Create the DOM host adapter.
 *
 * @param options - The document to observe and the scheduler to use. Defaults to the ambient
 * document and the browser scheduler.
 * @returns The adapter.
 */
export function createDomHostAdapter(options?: {
    document?: Document
    scheduler?: SchedulerPort
}): DomHostAdapter {
    const document = options?.document ?? resolveDocument()
    const hosts = new WeakMap<Element, DomHost>()

    const hostOf = (element: Element): DomHost => {
        const existing = hosts.get(element)
        if (existing !== undefined) {
            return existing
        }
        const host: DomHost = {
            kind: 'element',
            element,
            get isConnected(): boolean {
                return element.isConnected
            },
            get parent(): Host | null {
                const parent = composedParent(element)
                return parent === null ? null : hostOf(parent)
            },
            native: () => element,
            on(
                type: string,
                listener: HostEventListener,
                listenerOptions?: HostListenerOptions,
            ): () => void {
                const options = listenerOptions?.signal === undefined
                    ? undefined
                    : { signal: listenerOptions.signal }
                element.addEventListener(type, listener as unknown as EventListener, options)
                return () => {
                    element.removeEventListener(type, listener as unknown as EventListener)
                }
            },
        }
        hosts.set(element, host)
        return host
    }

    const scope = createDomScopeTransport({ document, hostOf })
    const scheduler = options?.scheduler ?? createBrowserScheduler()
    const observer = createDomObserver(document, scheduler)

    const connectivity: ConnectivityPort = {
        isConnected(host: Host): boolean {
            return isDomHost(host) ? host.element.isConnected : true
        },
        subscribe(host: Host, listener: (connected: boolean, owner?: unknown) => void): () => void {
            if (!isDomHost(host)) {
                return () => undefined
            }
            return observer.observe(host.element, listener)
        },
    }

    const tokens: TokensPort = {
        read(host: Host): string | null {
            if (!isDomHost(host)) {
                return null
            }
            return host.element.getAttribute(KEYED_IDENTITY_ATTRIBUTE)
        },
        write(host: Host, token: string): void {
            validateTokenName(token)
            if (!isDomHost(host)) {
                return
            }
            host.element.setAttribute(KEYED_IDENTITY_ATTRIBUTE, token)
        },
        remove(host: Host, token: string): void {
            if (!isDomHost(host)) {
                return
            }
            if (host.element.getAttribute(KEYED_IDENTITY_ATTRIBUTE) === token) {
                host.element.removeAttribute(KEYED_IDENTITY_ATTRIBUTE)
            }
        },
    }

    return {
        scope,
        observer,
        connectivity,
        scheduler,
        tokens,
        hostOf,
        normalize(target: unknown): DomHost {
            if (!isElement(target)) {
                throw new DocumentContextError(
                    'HOST_INVALID',
                    'A DOM host must be an element.',
                )
            }
            return hostOf(target)
        },
        release(): void {
            observer.release()
            scope.release()
        },
    }
}

/**
 * The scheduler of the browser: microtasks, timeouts and frames.
 *
 * @returns The scheduler.
 */
export function createBrowserScheduler(): SchedulerPort {
    return {
        microtask(task: () => void): () => void {
            let cancelled = false
            queueMicrotask(() => {
                if (!cancelled) {
                    task()
                }
            })
            return () => {
                cancelled = true
            }
        },
        timeout(task: () => void, delayMs: number): () => void {
            const handle = setTimeout(task, delayMs)
            return () => {
                clearTimeout(handle)
            }
        },
        frame(task: () => void): () => void {
            if (typeof requestAnimationFrame === 'function') {
                const handle = requestAnimationFrame(() => {
                    task()
                })
                return () => {
                    cancelAnimationFrame(handle)
                }
            }
            let cancelled = false
            queueMicrotask(() => {
                if (!cancelled) {
                    task()
                }
            })
            return () => {
                cancelled = true
            }
        },
    }
}

function isDomHost(host: Host): host is DomHost {
    return 'element' in host
}

function resolveDocument(): Document {
    if (typeof document === 'undefined') {
        throw new DocumentContextError(
            'HOST_INVALID',
            'No document is available. Pass one explicitly when creating the DOM adapter.',
        )
    }
    return document
}
