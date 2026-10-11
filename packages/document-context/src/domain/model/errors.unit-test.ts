import { describe, expect, it } from 'vitest'
import { DocumentContextError } from './errors.js'
import type { DocumentContextErrorCode } from './errors.js'

const ALL_CODES: ReadonlyArray<DocumentContextErrorCode> = [
    'UNKNOWN_SERVICE',
    'CIRCULAR_DEPENDENCY',
    'DISPOSED_SESSION',
    'UNCONNECTED_NODE',
    'ASYNC_SERVICE_NOT_READY',
    'KEYED_SESSION_CONFLICT',
    'TOKEN_INVALID',
    'HOST_INVALID',
    'SINGLETON_CONFLICT',
    'INVALID_STORAGE_DATA',
    'HOOK_ERROR',
    'RESOLUTION_TIMEOUT',
]

describe('DocumentContextError', () => {
    it('covers all 12 taxonomy codes', () => {
        expect(ALL_CODES).toHaveLength(12)
        for (const code of ALL_CODES) {
            const error = new DocumentContextError(code)
            expect(error.code).toBe(code)
        }
    })

    it('is an Error carrying the DocumentContextError name', () => {
        const error = new DocumentContextError('UNKNOWN_SERVICE', { token: 'app:user' })
        expect(error).toBeInstanceOf(Error)
        expect(error).toBeInstanceOf(DocumentContextError)
        expect(error.name).toBe('DocumentContextError')
    })

    it('defaults details to an empty record', () => {
        const error = new DocumentContextError('DISPOSED_SESSION')
        expect(error.details).toEqual({})
    })

    it('preserves provided details without aliasing the input object', () => {
        const details = { token: 'app:user' }
        const error = new DocumentContextError('UNKNOWN_SERVICE', details)
        expect(error.details).toEqual({ token: 'app:user' })
        details.token = 'app:other'
        expect(error.details).toEqual({ token: 'app:user' })
    })

    it('freezes details against later mutation', () => {
        const error = new DocumentContextError('TOKEN_INVALID', { token: 'bad', reason: 'missing-namespace' })
        expect(Object.isFrozen(error.details)).toBe(true)
    })

    it('provides a default message containing the code', () => {
        for (const code of ALL_CODES) {
            const error = new DocumentContextError(code)
            expect(error.message).toContain(code)
        }
    })

    it('honours a custom message override', () => {
        const error = new DocumentContextError('UNKNOWN_SERVICE', {}, { message: 'custom-message' })
        expect(error.message).toBe('custom-message')
    })

    it('provides a non-empty default resolution guide per code', () => {
        for (const code of ALL_CODES) {
            const error = new DocumentContextError(code)
            expect(typeof error.resolutionGuide).toBe('string')
            expect(error.resolutionGuide.length).toBeGreaterThan(0)
        }
    })

    it('honours a custom resolution guide override', () => {
        const error = new DocumentContextError(
            'HOOK_ERROR',
            { hook: 'mount', error: 'boom' },
            { resolutionGuide: 'custom-guide' },
        )
        expect(error.resolutionGuide).toBe('custom-guide')
    })
})
