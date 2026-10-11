/**
 * SSR payload resolver.
 *
 * This module reads server-rendered JSON payloads embedded as
 * `<script type="application/json">` elements. Resolution is a one-shot
 * `getElementById` lookup with safe degradation to null on any failure
 * (missing element, empty text, unparsable JSON, or a throwing document), so
 * hydration always falls through to the next source instead of interrupting
 * the mount. It never uses `querySelector`: token suffixes contain `:`, which
 * CSS parses as pseudo-classes, while `getElementById` is exact, colon-safe,
 * and faster. No DOM is touched at import time; the document enters only
 * through the factory parameter.
 *
 * The payload-reader type is canonical in `application/context.js`; this
 * module reuses it by type-only import so the shape cannot drift. The import
 * is erased at runtime, keeping this entry free of application code.
 */
import type { PayloadResolver } from '../../application/context.js'

export type { PayloadResolver }

/**
 * Minimal document surface required by the resolver. Deliberately narrower
 * than `Document`: only `getElementById` is ever called, which the type
 * guarantees at compile time.
 */
export interface PayloadDocument {
    /**
     * Returns the element with the exact id, or null when absent.
     *
     * @param id Element id to look up.
     * @returns The matching element, or null.
     */
    getElementById(id: string): { readonly textContent: string | null } | null
}

/**
 * Builds the payload element id for a token: `__dc_state:<token>` for keyed
 * sessions, `__dc_state` for anonymous ones.
 *
 * @param token Keyed identity, or null for the anonymous payload.
 * @returns The payload element id.
 * @example
 * ```ts
 * import { payloadIdFor } from './payload-resolver.js'
 *
 * const id = payloadIdFor('app:cart')
 * ```
 */
export function payloadIdFor(token: string | null): string {
    return token === null ? '__dc_state' : `__dc_state:${token}`
}

/**
 * Creates a payload resolver bound to one document. Pure factory: no DOM is
 * touched until the returned resolver runs, and each resolution is
 * independent (no caching, no subscriptions), so per-request documents stay
 * isolated.
 *
 * @param document Document (or test double) serving the payload elements.
 * @returns The one-shot payload resolver.
 * @example
 * ```ts
 * import { createPayloadResolver } from './payload-resolver.js'
 *
 * const resolvePayload = createPayloadResolver(document)
 * const payload = resolvePayload('app:cart')
 * ```
 */
export function createPayloadResolver(document: PayloadDocument): PayloadResolver {
    return (token: string | null): unknown | null => {
        let element: { readonly textContent: string | null } | null
        try {
            element = document.getElementById(payloadIdFor(token))
        } catch {
            return null
        }
        if (element === null) {
            return null
        }
        const text = element.textContent
        if (text === null || text === '') {
            return null
        }
        try {
            return JSON.parse(text) as unknown
        } catch {
            return null
        }
    }
}
