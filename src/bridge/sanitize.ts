import { PropertySyncSecurityError } from '../core/errors'

const DANGEROUS_TOKENS = new Set(['__proto__', 'prototype', 'constructor'])
const DANGEROUS_SINKS = new Set([
    'innerhtml',
    'outerhtml',
    'insertadjacenthtml',
    'srcdoc',
    'script',
    'eval'
])

/**
 * Rejects bridge paths that enable prototype pollution or target XSS sinks.
 *
 * Splits `path` on `.`, trims, and lowercases each segment: segments
 * `__proto__`, `prototype`, `constructor` throw with the offending
 * `blockedSegment`; segments `innerhtml`, `outerhtml`, `insertadjacenthtml`,
 * `srcdoc`, `script`, `eval` throw with the offending `blockedSink`. Called
 * by both `readDomProperty()` and `writeDomProperty()`, so bad mappings fail
 * fast at mount or first sync rather than writing somewhere dangerous.
 *
 * @param path - Bridge dot-path as written in the blueprint.
 * @param targetNode - Optional host element used only to derive the tag name
 * in the error diagnostic.
 * @returns `void` when the path is safe.
 * @throws {PropertySyncSecurityError} When any segment is blocked.
 *
 * @example
 * ```ts
 * import { validatePropertyPath } from '@sandlada/document-context'
 *
 * validatePropertyPath('dataset.count', el)
 * ```
 */
export function validatePropertyPath(path: string, targetNode?: HTMLElement): void {
    const segments = path.split('.').map((s) => s.trim().toLowerCase())

    for (const segment of segments) {
        if (DANGEROUS_TOKENS.has(segment)) {
            throw new PropertySyncSecurityError({
                dangerousPath: path,
                targetNode: targetNode?.tagName?.toLowerCase(),
                details: { blockedSegment: segment },
                resolutionGuide: 'Do not use prototype or constructor properties in bridge mappings.'
            })
        }
        if (DANGEROUS_SINKS.has(segment)) {
            throw new PropertySyncSecurityError({
                dangerousPath: path,
                targetNode: targetNode?.tagName?.toLowerCase(),
                details: { blockedSink: segment },
                resolutionGuide: 'Direct mapping to HTML injection sinks (e.g. innerHTML, outerHTML) is strictly disallowed.'
            })
        }
    }
}

/**
 * Parses DOM-sourced values to boolean with bridge type fidelity.
 *
 * Returns `true` only for `true`, `'true'`, and `'1'`; everything else
 * (including `'false'`, `''`, `null`, and `undefined`) is `false`. Use as the
 * `parse` codec for `aria-*` / `dataset.*` boolean bindings.
 *
 * @param value - Raw DOM value (usually a string).
 * @returns The parsed boolean.
 *
 * @example
 * ```ts
 * import { parseBoolean } from '@sandlada/document-context'
 *
 * withBridge({ properties: { open: { target: 'aria-expanded', parse: parseBoolean } } })
 * ```
 */
export function parseBoolean(value: unknown): boolean {
    if (value === true || value === 'true' || value === '1') {
        return true
    }
    return false
}

/**
 * Parses DOM-sourced values to number via `Number(value)`.
 *
 * Empty strings coerce to `0` and non-numeric input to `NaN`; apply a fallback
 * (`Number(x) || 0`) in the binding when that matters. Use as the `parse`
 * codec for `dataset.*` numeric bindings.
 *
 * @param value - Raw DOM value (usually a string).
 * @returns The numeric coercion, possibly `NaN`.
 *
 * @example
 * ```ts
 * import { parseNumber } from '@sandlada/document-context'
 *
 * withBridge({ properties: { count: { target: 'dataset.count', parse: parseNumber } } })
 * ```
 */
export function parseNumber(value: unknown): number {
    return Number(value)
}

/**
 * Parses JSON-serialized DOM values with a safe fallback.
 *
 * Non-strings pass through untouched; strings are `JSON.parse()`-ed, and
 * parse failures return the original string instead of throwing. Ideal for
 * `dataset.*` bindings carrying objects or arrays.
 *
 * @param value - Raw DOM value.
 * @returns The parsed value, or the input unchanged when parsing is
 * inapplicable or fails.
 *
 * @example
 * ```ts
 * import { parseJSON } from '@sandlada/document-context'
 *
 * withBridge({ properties: { filters: { target: 'dataset.filters', parse: parseJSON } } })
 * ```
 */
export function parseJSON(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value
    }
    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}
