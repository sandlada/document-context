import { describe, expect, it } from 'vitest'
import { createContext } from './context'
import { withHook } from './hooks'
import { mount } from './mount'
import { pipe } from './pipe'

describe('mount', () => {
    it('creates an active session on a physical DOM element', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 0 })

        const session = mount(bp)(el)

        expect(session).toBeDefined()
        expect(session.target).toBe(el)
        expect(session.blueprint).toBe(bp)
        expect(session.isDisposed).toBe(false)
        expect(session.abortSignal).toBeInstanceOf(AbortSignal)
        expect(session.abortSignal.aborted).toBe(false)
    })

    it('returns the same cached session when mounted idempotently on the same element', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 0 })

        const session1 = mount(bp)(el)
        const session2 = mount(bp)(el)

        expect(session1).toBe(session2)
    })

    it('executes mount hooks in FIFO order and dispatches context-mount event', () => {
        const el = document.createElement('div')
        const hookOrder: string[] = []
        let eventFired = false

        el.addEventListener('context-mount', (e: any) => {
            eventFired = true
            expect(e.detail.session).toBeDefined()
        })

        const bp = pipe(
            createContext({}),
            withHook('mount', () => {
                hookOrder.push('hook1')
            }),
            withHook('mount', () => {
                hookOrder.push('hook2')
            })
        )

        mount(bp)(el)

        expect(hookOrder).toEqual(['hook1', 'hook2'])
        expect(eventFired).toBe(true)
    })

    it('handles async mount hooks safely without blocking synchronous return of session', () => {
        const el = document.createElement('div')

        const bp = pipe(
            createContext({}),
            withHook('mount', async () => {
                await Promise.resolve()
            })
        )

        const session = mount(bp)(el)
        expect(session).toBeDefined()
    })
})
