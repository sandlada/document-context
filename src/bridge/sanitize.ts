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
 * Validates a dot-path to block prototype pollution and dangerous DOM XSS sinks.
 *
 * @param path The property dot-path.
 * @param targetNode Optional target DOM node for diagnostic error reporting.
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
 * Type-fidelity parser for boolean DOM values.
 */
export function parseBoolean(value: unknown): boolean {
    if (value === true || value === 'true' || value === '1') {
        return true
    }
    return false
}

/**
 * Type-fidelity parser for numeric DOM values.
 */
export function parseNumber(value: unknown): number {
    return Number(value)
}

/**
 * Type-fidelity parser for JSON-serialized DOM values.
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
