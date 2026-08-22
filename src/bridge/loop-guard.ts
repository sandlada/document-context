export const InternalWriteSymbol = Symbol('InternalWriteTransaction')

/**
 * Executes a DOM write operation within an internal transaction lock.
 *
 * @param element The target HTMLElement.
 * @param writeFn The write callback.
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
 * Checks if the element is currently undergoing an internal write transaction.
 */
export function isInternalWrite(element: HTMLElement): boolean {
    return Boolean((element as any)[InternalWriteSymbol])
}

/**
 * Safely updates input value while preserving active selection cursor and avoiding unnecessary reflows.
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
