import { describe, expect, it } from 'vitest'
import {
    DocumentContextError,
    isDocumentContextError,
    toDocumentContextError,
} from './errors'

describe('errors', () => {
    it('[ERR #1] 每種失敗都有穩定識別碼', () => {
        const error = new DocumentContextError('UNKNOWN_SERVICE', 'missing')
        expect(error.code).toBe('UNKNOWN_SERVICE')
        expect(error.message).toBe('missing')
        expect(error.name).toBe('DocumentContextError')
    })

    it('[ERR #1] isDocumentContextError 只認本庫的錯誤型別', () => {
        expect(isDocumentContextError(new DocumentContextError('HOOK_ERROR', 'x'))).toBe(true)
        expect(isDocumentContextError(new Error('x'))).toBe(false)
        expect(isDocumentContextError('x')).toBe(false)
    })

    it('[ERR #1] toDocumentContextError 保留原本的錯誤型別', () => {
        const original = new DocumentContextError('HOOK_ERROR', 'x')
        expect(toDocumentContextError(original, 'UNKNOWN_SERVICE', 'fallback')).toBe(original)
    })

    it('[ERR #1] toDocumentContextError 包裝未知值並保留 cause', () => {
        const wrapped = toDocumentContextError(new Error('boom'), 'HOOK_ERROR', 'fallback')
        expect(wrapped.code).toBe('HOOK_ERROR')
        expect(wrapped.message).toBe('boom')
        expect(wrapped.details?.['cause']).toBeInstanceOf(Error)
    })
})
