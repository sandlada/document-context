/**
 * The composed tree of the DOM.
 *
 * The scope chain of the library walks the composed ancestor chain: ordinary parent nodes and
 * shadow hosts. The chain never crosses a document boundary.
 */

/**
 * Whether a node is a shadow root.
 *
 * @param node - The node to test.
 * @returns `true` for shadow roots, `false` for document fragments.
 */
export function isShadowRoot(node: unknown): node is ShadowRoot {
    return (
        typeof node === 'object' &&
        node !== null &&
        (node as { nodeType?: unknown }).nodeType === 11 &&
        'host' in (node as Record<string, unknown>)
    )
}

/**
 * The composed ancestor of an element.
 *
 * @param element - The element.
 * @returns The parent element, the shadow host, or `null` at the end of the chain.
 */
export function composedParent(element: Element): Element | null {
    const parent = element.parentElement
    if (parent !== null) {
        return parent
    }
    const root = element.getRootNode()
    return isShadowRoot(root) ? root.host : null
}

/**
 * The composed ancestor chain of an element, nearest first.
 *
 * @param element - The element.
 * @returns The chain, ending with the outermost element.
 */
export function composedAncestors(element: Element): Element[] {
    const chain: Element[] = []
    const seen = new Set<Element>()
    let current = composedParent(element)
    while (current !== null && !seen.has(current)) {
        seen.add(current)
        chain.push(current)
        current = composedParent(current)
    }
    return chain
}

/**
 * Whether an element lives inside another element along the composed chain.
 *
 * @param ancestor - The ancestor element.
 * @param descendant - The candidate descendant.
 * @returns `true` when the descendant is inside the ancestor.
 */
export function domContains(ancestor: Element, descendant: Element): boolean {
    if (ancestor === descendant) {
        return true
    }
    return composedAncestors(descendant).includes(ancestor)
}
