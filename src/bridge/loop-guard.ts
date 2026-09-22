/**
 * Symbol-keyed re-entrancy flag marking an element inside a state-to-DOM
 * transaction. Set by `writeWithTransaction()` and observed by
 * `isInternalWrite()`; stored on the element itself so concurrent bridges on
 * different elements never interfere.
 */
export const InternalWriteSymbol = Symbol('InternalWriteTransaction')

/**
 * Runs a DOM write callback under the internal-transaction lock.
 *
 * Sets the element flag, invokes `writeFn`, and always clears the flag in a
 * `finally` block, so bridge-originated writes are recognizable to the
 * DOM-to-state listener, which skips them and breaks echo loops. Synchronous
 * only; exceptions from `writeFn` propagate after the flag is cleared.
 *
 * @param element - Host element whose flag is set for the duration.
 * @param writeFn - Synchronous DOM write callback.
 * @returns `void`.
 *
 * @example
 * ```ts
 * import { writeWithTransaction } from '@sandlada/document-context'
 *
 * writeWithTransaction(el, () => {
 *     el.dataset.count = String(state.count)
 * })
 * ```
 */
export function writeWithTransaction(
    element: HTMLElement,
    writeFn: () => void
): void {
    ;(element as any)[InternalWriteSymbol] = true
    try {
        writeFn()
    } finally {
        ;(element as any)[InternalWriteSymbol] = false
    }
}

/**
 * Reports whether an element is currently inside a `writeWithTransaction()`
 * lock.
 *
 * The bridge DOM-to-state listener consults this first and bails out when
 * `true`, so programmatic state-to-DOM writes never echo back into `update()`.
 *
 * @param element - Host element to inspect.
 * @returns `true` during an internal write transaction, otherwise `false`.
 *
 * @example
 * ```ts
 * import { isInternalWrite } from '@sandlada/document-context'
 *
 * el.addEventListener('input', () => {
 *     if (isInternalWrite(el)) {
 *         return
 *     }
 * })
 * ```
 */
export function isInternalWrite(element: HTMLElement): boolean {
    return Boolean((element as any)[InternalWriteSymbol])
}

/**
 * Writes an input/textarea value without moving the user's caret or causing
 * redundant reflows.
 *
 * No-ops when `inputElement.value` already `Object.is`-equals `nextValue`.
 * When the element is the focused `document.activeElement` with a numeric
 * selection, the caret is captured and restored via `setSelectionRange()`;
 * input types that reject selection APIs (for example `email`, `number`) are
 * shielded by try/catch. Background (unfocused) inputs are written plainly.
 *
 * @param inputElement - Target `HTMLInputElement` or `HTMLTextAreaElement`.
 * @param nextValue - String value to display.
 * @returns `void`.
 *
 * @example
 * ```ts
 * import { safeWriteValueWithCursor } from '@sandlada/document-context'
 *
 * safeWriteValueWithCursor(input, String(state.query))
 * ```
 */
export function safeWriteValueWithCursor(
    inputElement: HTMLInputElement | HTMLTextAreaElement,
    nextValue: string
): void {
    if (Object.is(inputElement.value, nextValue)) {
        return
    }

    const isActive =
        typeof document !== 'undefined' && document.activeElement === inputElement

    if (isActive && typeof inputElement.selectionStart === 'number') {
        const start = inputElement.selectionStart
        const end = inputElement.selectionEnd
        inputElement.value = nextValue
        try {
            inputElement.setSelectionRange(start, end)
        } catch {
            // Some input types (e.g. email/number) may throw on setSelectionRange
        }
    } else {
        inputElement.value = nextValue
    }
}
