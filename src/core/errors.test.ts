import { describe, expect, it } from 'vitest'
import {
    AsyncServiceNotReadyError,
    CircularDependencyError,
    DisposedSessionError,
    DocumentContextError,
    HydrationMismatchError,
    InvalidStorageDataError,
    PropertySyncSecurityError,
    UnconnectedNodeError,
    UnknownServiceError
} from './errors'

describe('Error Taxonomy', () => {
    describe('DocumentContextError Base Class', () => {
        it('should properly instantiate with code, details, and resolution guide', () => {
            const err = new DocumentContextError({
                code: 'TEST_ERROR',
                message: 'A test error occurred',
                details: { foo: 'bar' },
                resolutionGuide: 'Check your test configuration.'
            })

            expect(err).toBeInstanceOf(Error)
            expect(err).toBeInstanceOf(DocumentContextError)
            expect(err.name).toBe('DocumentContextError')
            expect(err.code).toBe('TEST_ERROR')
            expect(err.message).toBe('A test error occurred')
            expect(err.details).toEqual({ foo: 'bar' })
            expect(err.resolutionGuide).toBe('Check your test configuration.')
            expect(err.toString()).toContain('[TEST_ERROR] DocumentContextError: A test error occurred')
            expect(err.toString()).toContain('Resolution Guide: Check your test configuration.')
        })

        it('should preserve error cause when provided', () => {
            const cause = new Error('Original root cause')
            const err = new DocumentContextError({
                code: 'WRAPPER_ERROR',
                message: 'Wrapped error message',
                cause
            })

            expect(err.cause).toBe(cause)
        })
    })

    describe('CircularDependencyError', () => {
        it('should support array positional arguments', () => {
            const path = ['ServiceA', 'ServiceB', 'ServiceC', 'ServiceA']
            const err = new CircularDependencyError(path)

            expect(err).toBeInstanceOf(DocumentContextError)
            expect(err).toBeInstanceOf(CircularDependencyError)
            expect(err.name).toBe('CircularDependencyError')
            expect(err.code).toBe('CIRCULAR_DEPENDENCY')
            expect(err.dependencyPath).toEqual(path)
            expect(err.message).toContain('ServiceA -> ServiceB -> ServiceC -> ServiceA')
            expect(err.details).toEqual({ dependencyPath: path })
            expect(err.resolutionGuide).toContain('Break the dependency cycle')
        })

        it('should support structured options object and custom message', () => {
            const path = ['A', 'B', 'A']
            const err = new CircularDependencyError({
                dependencyPath: path,
                message: 'Custom circular message',
                resolutionGuide: 'Custom guide'
            })

            expect(err.code).toBe('CIRCULAR_DEPENDENCY')
            expect(err.message).toBe('Custom circular message')
            expect(err.resolutionGuide).toBe('Custom guide')
            expect(err.dependencyPath).toEqual(path)
        })
    })

    describe('UnknownServiceError', () => {
        it('should support positional token and HTMLElement target', () => {
            const element = document.createElement('section')
            const err = new UnknownServiceError('auth-service', element)

            expect(err).toBeInstanceOf(DocumentContextError)
            expect(err).toBeInstanceOf(UnknownServiceError)
            expect(err.name).toBe('UnknownServiceError')
            expect(err.code).toBe('UNKNOWN_SERVICE')
            expect(err.token).toBe('auth-service')
            expect(err.targetElement).toBe(element)
            expect(err.message).toContain("'auth-service'")
            expect(err.message).toContain('<section>')
            expect(err.details).toEqual({ token: 'auth-service', targetElement: element })
            expect(err.resolutionGuide).toContain('withProvider()')
        })

        it('should support string target or undefined target', () => {
            const err1 = new UnknownServiceError('theme-service', 'div#header')
            expect(err1.message).toContain('<div#header>')

            const err2 = new UnknownServiceError('theme-service')
            expect(err2.message).toContain('<unknown element>')
        })

        it('should support options object', () => {
            const err = new UnknownServiceError({
                token: 'cart-service',
                targetElement: 'main',
                message: 'Explicit message'
            })

            expect(err.token).toBe('cart-service')
            expect(err.targetElement).toBe('main')
            expect(err.message).toBe('Explicit message')
        })
    })

    describe('AsyncServiceNotReadyError', () => {
        it('should format message with token and actionable guidance', () => {
            const err = new AsyncServiceNotReadyError('user-data')

            expect(err).toBeInstanceOf(DocumentContextError)
            expect(err).toBeInstanceOf(AsyncServiceNotReadyError)
            expect(err.name).toBe('AsyncServiceNotReadyError')
            expect(err.code).toBe('ASYNC_SERVICE_NOT_READY')
            expect(err.token).toBe('user-data')
            expect(err.message).toContain("'user-data'")
            expect(err.resolutionGuide).toContain("injectAsync('user-data')")
        })

        it('should support options object', () => {
            const err = new AsyncServiceNotReadyError({
                token: 'config-loader',
                message: 'Custom async message'
            })

            expect(err.token).toBe('config-loader')
            expect(err.message).toBe('Custom async message')
        })
    })

    describe('DisposedSessionError', () => {
        it('should instantiate with or without sessionKey', () => {
            const err1 = new DisposedSessionError()
            expect(err1).toBeInstanceOf(DocumentContextError)
            expect(err1.code).toBe('DISPOSED_SESSION')
            expect(err1.sessionKey).toBeUndefined()
            expect(err1.message).toBe('Attempted operation on a disposed session.')

            const err2 = new DisposedSessionError('session-42')
            expect(err2.sessionKey).toBe('session-42')
            expect(err2.message).toContain("key: 'session-42'")
            expect(err2.resolutionGuide).toContain('session.isDisposed')
        })

        it('should support options object', () => {
            const err = new DisposedSessionError({
                sessionKey: 'my-session',
                message: 'Custom disposed message'
            })

            expect(err.sessionKey).toBe('my-session')
            expect(err.message).toBe('Custom disposed message')
        })
    })

    describe('UnconnectedNodeError', () => {
        it('should describe unconnected element and resolution guidance', () => {
            const button = document.createElement('button')
            const err = new UnconnectedNodeError('analytics', button)

            expect(err).toBeInstanceOf(DocumentContextError)
            expect(err.code).toBe('UNCONNECTED_NODE')
            expect(err.token).toBe('analytics')
            expect(err.targetNode).toBe(button)
            expect(err.message).toContain("'analytics'")
            expect(err.message).toContain('<button>')
            expect(err.resolutionGuide).toContain('node.isConnected === true')
        })

        it('should handle non-element target or options object', () => {
            const err = new UnconnectedNodeError({
                token: 'analytics',
                message: 'Custom unconnected message'
            })

            expect(err.token).toBe('analytics')
            expect(err.message).toBe('Custom unconnected message')
        })
    })

    describe('PropertySyncSecurityError', () => {
        it('should report dangerous path and target element', () => {
            const input = document.createElement('input')
            const err = new PropertySyncSecurityError('__proto__.polluted', input)

            expect(err).toBeInstanceOf(DocumentContextError)
            expect(err.code).toBe('PROPERTY_SYNC_SECURITY_VIOLATION')
            expect(err.dangerousPath).toBe('__proto__.polluted')
            expect(err.targetNode).toBe(input)
            expect(err.message).toContain("'__proto__.polluted'")
            expect(err.message).toContain('<input>')
            expect(err.resolutionGuide).toContain('prototype pollution')
        })

        it('should support options object', () => {
            const err = new PropertySyncSecurityError({
                dangerousPath: 'innerHTML',
                targetNode: 'app-root',
                message: 'XSS sink blocked'
            })

            expect(err.dangerousPath).toBe('innerHTML')
            expect(err.targetNode).toBe('app-root')
            expect(err.message).toBe('XSS sink blocked')
        })
    })

    describe('HydrationMismatchError', () => {
        it('should report property key, expected value, and actual value', () => {
            const err = new HydrationMismatchError('theme', 'dark', 'light')

            expect(err).toBeInstanceOf(DocumentContextError)
            expect(err.code).toBe('HYDRATION_MISMATCH')
            expect(err.propertyKey).toBe('theme')
            expect(err.expectedValue).toBe('dark')
            expect(err.actualValue).toBe('light')
            expect(err.message).toContain("'theme'")
            expect(err.message).toContain('"dark"')
            expect(err.message).toContain('"light"')
            expect(err.resolutionGuide).toContain('hydrationStrategy')
        })

        it('should support options object', () => {
            const err = new HydrationMismatchError({
                propertyKey: 'counter',
                expectedValue: 10,
                actualValue: 0
            })

            expect(err.propertyKey).toBe('counter')
            expect(err.expectedValue).toBe(10)
            expect(err.actualValue).toBe(0)
        })
    })

    describe('InvalidStorageDataError', () => {
        it('should report corrupted key and raw data', () => {
            const raw = '{invalid_json: true,'
            const err = new InvalidStorageDataError('user-cache', raw)

            expect(err).toBeInstanceOf(DocumentContextError)
            expect(err.code).toBe('INVALID_STORAGE_DATA')
            expect(err.key).toBe('user-cache')
            expect(err.rawData).toBe(raw)
            expect(err.message).toContain("'user-cache'")
            expect(err.resolutionGuide).toContain('migrate')
        })

        it('should support options object', () => {
            const err = new InvalidStorageDataError({
                key: 'session-store',
                rawData: 12345
            })

            expect(err.key).toBe('session-store')
            expect(err.rawData).toBe(12345)
        })
    })
})
