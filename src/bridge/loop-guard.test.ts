import { describe, expect, it } from 'vitest'
import {
    InternalWriteSymbol,
    isInternalWrite,
    safeWriteValueWithCursor,
    writeWithTransaction
} from './loop-guard'

describe('Bridge Loop Guard & Transaction Lock', () => {
    it('sets transaction lock during writeWithTransaction to prevent feedback loops', () => {
        const el = document.createElement('div')
        expect(isInternalWrite(el)).toBe(false)

        let wasLockedDuringWrite = false
        writeWithTransaction(el, () => {
            wasLockedDuringWrite = isInternalWrite(el)
        })

        expect(wasLockedDuringWrite).toBe(true)
        expect(isInternalWrite(el)).toBe(false)
    })

    it('preserves cursor selection when updating active element value', () => {
        const input = document.createElement('input')
        input.type = 'text'
        input.value = 'hello world'
        document.body.appendChild(input)
        input.focus()
        input.setSelectionRange(5, 5) // cursor after 'hello'

        // Safe update with same value should no-op
        safeWriteValueWithCursor(input, 'hello world')
        expect(input.selectionStart).toBe(5)
        expect(input.selectionEnd).toBe(5)

        // Update with new value preserves cursor range where applicable
        safeWriteValueWithCursor(input, 'hello brave world')
        expect(input.value).toBe('hello brave world')
        expect(input.selectionStart).toBe(5)

        document.body.removeChild(input)
    })
})
