import { describe, expect, it, vi } from 'vitest'
import { createContext } from '../core/context'
import { withAsyncProvider } from '../core/async-provider'
import { withProvider } from '../core/providers'
import { mount } from '../core/mount'
import { pipe } from '../core/pipe'
import {
    AsyncServiceNotReadyError,
    CircularDependencyError
} from '../core/errors'
import { inject } from './inject'
import { injectAsync } from './inject-async'

describe('injectAsync & Async DI', () => {
    it('resolves an async provider successfully', async () => {
        const bp = pipe(
            createContext({}),
            withAsyncProvider('user', async () => {
                await new Promise((r) => setTimeout(r, 10))
                return { name: 'Alice' }
            })
        )

        const el = document.createElement('div')
        document.body.appendChild(el)
        const session = mount(bp)(el)

        const user = await injectAsync<{ name: string }>('user')(session)
        expect(user).toEqual({ name: 'Alice' })

        document.body.removeChild(el)
    })

    it('coalesces concurrent injectAsync calls into a single in-flight Promise', async () => {
        let factoryCalls = 0
        const bp = pipe(
            createContext({}),
            withAsyncProvider('auth', async () => {
                factoryCalls++
                await new Promise((r) => setTimeout(r, 15))
                return { token: 'jwt-123' }
            })
        )

        const el = document.createElement('div')
        document.body.appendChild(el)
        const session = mount(bp)(el)

        const p1 = injectAsync<{ token: string }>('auth')(session)
        const p2 = injectAsync<{ token: string }>('auth')(session)
        const p3 = injectAsync<{ token: string }>('auth')(session)

        const [r1, r2, r3] = await Promise.all([p1, p2, p3])

        expect(factoryCalls).toBe(1)
        expect(r1).toBe(r2)
        expect(r2).toBe(r3)

        document.body.removeChild(el)
    })

    it('evicts failed promise from cache for self-healing retries', async () => {
        let attempts = 0
        const bp = pipe(
            createContext({}),
            withAsyncProvider('flaky-service', async () => {
                attempts++
                if (attempts === 1) {
                    throw new Error('Network error')
                }
                return { status: 'ok' }
            })
        )

        const el = document.createElement('div')
        document.body.appendChild(el)
        const session = mount(bp)(el)

        // Attempt 1: Fails
        await expect(injectAsync('flaky-service')(session)).rejects.toThrow(
            'Network error'
        )

        // Attempt 2: Self-healing retry succeeds
        const result = await injectAsync<{ status: string }>('flaky-service')(session)
        expect(result).toEqual({ status: 'ok' })
        expect(attempts).toBe(2)

        document.body.removeChild(el)
    })

    it('throws AsyncServiceNotReadyError when sync inject is called on pending async service', async () => {
        const bp = pipe(
            createContext({}),
            withAsyncProvider('async-item', async () => {
                await new Promise((r) => setTimeout(r, 30))
                return 'ready'
            })
        )

        const el = document.createElement('div')
        document.body.appendChild(el)
        const session = mount(bp)(el)

        // Sync inject before resolved throws AsyncServiceNotReadyError
        expect(() => {
            inject('async-item')(session)
        }).toThrow(AsyncServiceNotReadyError)

        // Await resolution
        const val = await injectAsync('async-item')(session)
        expect(val).toBe('ready')

        // Sync inject after resolved succeeds
        expect(inject('async-item')(session)).toBe('ready')

        document.body.removeChild(el)
    })

    it('detects async circular dependency and rejects with CircularDependencyError', async () => {
        const bp = pipe(
            createContext({}),
            withAsyncProvider('serviceA', async (s) => {
                const b = await injectAsync('serviceB')(s)
                return { b }
            }),
            withAsyncProvider('serviceB', async (s) => {
                const a = await injectAsync('serviceA')(s)
                return { a }
            })
        )

        const el = document.createElement('div')
        document.body.appendChild(el)
        const session = mount(bp)(el)

        await expect(injectAsync('serviceA')(session)).rejects.toThrow(
            CircularDependencyError
        )

        document.body.removeChild(el)
    })

    it('supports multi-caller abort isolation without killing shared task for other callers', async () => {
        let taskCompleted = false
        const bp = pipe(
            createContext({}),
            withAsyncProvider('shared-task', async () => {
                await new Promise((r) => setTimeout(r, 25))
                taskCompleted = true
                return 'done'
            })
        )

        const el = document.createElement('div')
        document.body.appendChild(el)
        const session = mount(bp)(el)

        const ac = new AbortController()

        // Caller 1: with abort signal
        const p1 = injectAsync('shared-task', { signal: ac.signal })(session)
        // Caller 2: without abort signal
        const p2 = injectAsync('shared-task')(session)

        // Abort caller 1 immediately
        ac.abort()

        await expect(p1).rejects.toThrow()
        const r2 = await p2
        expect(r2).toBe('done')
        expect(taskCompleted).toBe(true)

        document.body.removeChild(el)
    })
})
