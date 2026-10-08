/**
 * Resolves the session identity key for one host element.
 *
 * The explicit `IMountOptions.key` passed to `mount()` is authoritative; the
 * `data-context-key` attribute is its declarative projection and is consulted
 * only as a fallback. Values are trimmed; an empty or whitespace-only result
 * means the session is anonymous (`undefined`).
 *
 * Pure: performs no DOM writes and no I/O.
 *
 * @param element - Host element about to be mounted.
 * @param explicitKey - Value of `IMountOptions.key`, when provided.
 * @returns The normalized resolved key, or `undefined` for anonymous sessions.
 */
export function resolveSessionKey(
    element: HTMLElement,
    explicitKey?: string | undefined
): string | undefined {
    const raw = explicitKey ?? element.getAttribute('data-context-key')
    if (raw === null || raw === undefined) {
        return undefined
    }
    const trimmed = raw.trim()
    return trimmed === '' ? undefined : trimmed
}

/**
 * Normalizes the declarative projection of a resolved key onto the element.
 *
 * Called by `mount()` (fresh keyed mount) and by the resuscitation procedure
 * (new target) so the `data-context-key` attribute always mirrors the
 * authoritative resolved key. Anonymous sessions leave the attribute untouched.
 *
 * @param element - Host element receiving the projection.
 * @param key - Resolved key, or `undefined` for anonymous sessions.
 * @returns `void`.
 */
export function applyKeyProjection(element: HTMLElement, key: string | undefined): void {
    if (key === undefined) {
        return
    }
    element.setAttribute('data-context-key', key)
}
