/**
 * The DOM scope transport.
 *
 * Inside one document the transport keeps an in-memory index of the hosts that provide a token.
 * Across documents and across bundles it carries the Context Protocol event bus.
 */

import type {
    ContextRequestDetail,
    ProviderDeclaration,
    ScopeTransportPort,
} from '../../domain/ports/scope-transport'
import type { Host } from '../../domain/model/session'
import {
    CONTEXT_MOUNT_EVENT,
    dispatchContextAnnouncement,
    dispatchContextRequest,
    listenContextRequest,
} from './context-protocol'
import { domContains } from './session-stream'
import type { DomHost } from './host-adapter'

export interface DomScopeTransport extends ScopeTransportPort {
    /** The provider declarations per element. */
    readonly declarations: Map<Element, ProviderDeclaration[]>
}

/**
 * The key the shared provider index hangs on the document.
 *
 * The index belongs to the **document**, not to the module: two applications built on two adapters
 * of the same document see each other's providers, and the index disappears with the document.
 */
const registryKey = Symbol('document-context.providers')

/**
 * The provider index of a document.
 *
 * @param document - The document.
 * @returns The index, created on first use.
 */
function registryOf(document: Document): Map<Element, ProviderDeclaration[]> {
    const holder = document as unknown as Record<symbol, unknown>
    const existing = holder[registryKey]
    if (existing instanceof Map) {
        return existing as Map<Element, ProviderDeclaration[]>
    }
    const created = new Map<Element, ProviderDeclaration[]>()
    holder[registryKey] = created
    return created
}

/**
 * Create the DOM scope transport.
 *
 * @param options - The document and the host factory.
 * @returns The transport.
 */
export function createDomScopeTransport(options: {
    document: Document
    hostOf: (element: Element) => DomHost
}): DomScopeTransport {
    const declarations = registryOf(options.document)
    const providerListeners = new Set<() => void>()

    const onMount = (): void => {
        for (const listener of [...providerListeners]) {
            listener()
        }
    }
    options.document.addEventListener(CONTEXT_MOUNT_EVENT, onMount)

    return {
        declarations,
        // Another bundle may provide a token this bundle cannot see, so a miss is never final.
        authoritative: false,
        hostOf(target: unknown): Host | null {
            if (!isElement(target)) {
                return null
            }
            return options.hostOf(target)
        },
        contains(ancestor: Host, descendant: Host): boolean {
            if (!isDomHost(ancestor) || !isDomHost(descendant)) {
                return false
            }
            return domContains(ancestor.element, descendant.element)
        },
        declarationsOf(host: Host): readonly ProviderDeclaration[] {
            if (!isDomHost(host)) {
                return []
            }
            return declarations.get(host.element) ?? []
        },
        declare(host: Host, entries: readonly ProviderDeclaration[]): void {
            if (!isDomHost(host)) {
                return
            }
            declarations.set(host.element, [...entries])
        },
        undeclare(host: Host): void {
            if (!isDomHost(host)) {
                return
            }
            declarations.delete(host.element)
        },
        onRequest(host: Host, handler: (detail: ContextRequestDetail) => void): () => void {
            if (!isDomHost(host)) {
                return () => undefined
            }
            return listenContextRequest(host.element, handler)
        },
        request(host: Host, detail: ContextRequestDetail): void {
            if (!isDomHost(host)) {
                return
            }
            dispatchContextRequest(host.element, detail)
        },
        announce(host: Host, type: 'mount' | 'dispose', token: string | null): void {
            if (!isDomHost(host)) {
                return
            }
            dispatchContextAnnouncement(host.element, type, token)
        },
        onProviderChange(listener: () => void): () => void {
            providerListeners.add(listener)
            return () => {
                providerListeners.delete(listener)
            }
        },
    }
}

function isDomHost(host: Host): host is DomHost {
    return 'element' in host
}

/**
 * Whether a value is an element.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a DOM element.
 */
export function isElement(value: unknown): value is Element {
    return typeof Element !== 'undefined' && value instanceof Element
}
