/**
 * `merge` — the pure deep-merge helper.
 *
 * `merge` never writes to a session. It only produces a new object so that callers can build the
 * next snapshot themselves, for example `update((state) => merge(state, { user: { name: 'Ada' } }))`.
 */

import { isPlainObject, NON_COPIED_KEYS } from '../../domain/model/blueprint'

/**
 * Deep-merge two values.
 *
 * Plain objects are merged key by key. Arrays, `null`, dates and every other non-plain value are
 * replaced wholesale. Keys the patch does not mention are kept — `merge` never deletes. The
 * forbidden keys `__proto__`, `constructor` and `prototype` are never merged.
 *
 * @example
 * ```ts
 * import { merge } from '@sandlada/document-context'
 *
 * interface AppConfig {
 *     readonly theme: 'light' | 'dark'
 *     readonly features: {
 *         readonly analytics: boolean
 *         readonly betaUI: boolean
 *     }
 * }
 *
 * const baseConfig: AppConfig = {
 *     theme: 'light',
 *     features: { analytics: true, betaUI: false },
 * }
 *
 * // Deep merge nested patch without mutating baseConfig
 * const merged = merge(baseConfig, {
 *     theme: 'dark' as const,
 *     features: { betaUI: true },
 * })
 *
 * console.log(merged)
 * // { theme: 'dark', features: { analytics: true, betaUI: true } }
 * ```
 *
 * @param base - The base value.
 * @param patch - The patch value.
 * @returns The merged value.
 * @throws An `Error` when a circular reference is detected.
 */
export function merge<T extends object>(base: T, patch: Partial<T>): T
export function merge<T extends object, P extends object>(base: T, patch: P): T & P
export function merge<T extends object>(base: T, patch: object): T {
    return mergeValue(base, patch, new Set<object>()) as T
}

function mergeValue(base: unknown, patch: unknown, stack: Set<object>): unknown {
    if (!isPlainObject(patch)) {
        return patch
    }
    const baseIsPlain = isPlainObject(base)
    if (stack.has(patch) || (baseIsPlain && stack.has(base as object))) {
        throw new Error('merge: circular reference detected')
    }
    stack.add(patch)
    if (baseIsPlain) {
        stack.add(base as object)
    }
    try {
        const result: Record<string, unknown> = Object.create(
            (baseIsPlain ? Object.getPrototypeOf(base) : Object.getPrototypeOf(patch)) as object | null,
        )
        if (baseIsPlain) {
            for (const [key, value] of Object.entries(base as Record<string, unknown>)) {
                if (NON_COPIED_KEYS.has(key)) {
                    continue
                }
                result[key] = isPlainObject(value) ? mergeValue(value, {}, stack) : value
            }
        }
        for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
            if (NON_COPIED_KEYS.has(key)) {
                continue
            }
            result[key] = isPlainObject(value)
                ? mergeValue(result[key], value, stack)
                : value
        }
        return result
    } finally {
        stack.delete(patch)
        if (baseIsPlain) {
            stack.delete(base as object)
        }
    }
}
