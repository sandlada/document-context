/**
 * Tests for the server-side null host stub.
 *
 * The null host lets server runtimes mount through the identical `HostPort`
 * API with no connection gate, no subscriptions, and no native node.
 */
import { describe, expect, it } from 'vitest'
import { NEVER, type Subscription } from 'rxjs'
import { DocumentContextError } from '../../domain/model/errors.js'
import { createNullHost } from './null-host.js'

describe('createNullHost', () => {
    it('returns a shared stateless singleton', () => {
        expect(createNullHost()).toBe(createNullHost())
    })

    it('is anonymous, connected, and scope-rooted for gateless server mounts', () => {
        const host = createNullHost()
        expect(host.token).toBeNull()
        expect(host.isConnected).toBe(true)
        expect(host.parent).toBeNull()
    })

    it('exposes NEVER as lifecycle$: subscribing emits nothing, ever', async () => {
        const host = createNullHost()
        expect(host.lifecycle$).toBe(NEVER)
        let next = 0
        let errored = false
        let completed = false
        const subscription: Subscription = host.lifecycle$.subscribe({
            next: () => { next += 1 },
            error: () => { errored = true },
            complete: () => { completed = true },
        })
        await Promise.resolve()
        await Promise.resolve()
        expect(next).toBe(0)
        expect(errored).toBe(false)
        expect(completed).toBe(false)
        subscription.unsubscribe()
    })

    it('on() is a documented no-op returning an idempotent unsubscribe', () => {
        const host = createNullHost()
        let calls = 0
        const off = host.on('input', () => { calls += 1 })
        expect(typeof off).toBe('function')
        expect(() => {
            off()
            off()
        }).not.toThrow()
        expect(calls).toBe(0)
    })

    it('native() throws HOST_INVALID: the server has no native node', () => {
        const host = createNullHost()
        let caught: unknown = null
        try {
            host.native()
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(DocumentContextError)
        expect((caught as DocumentContextError).code).toBe('HOST_INVALID')
    })
})
