import { describe, expect, it } from 'vitest'
import { createContext } from './context'
import { KeyedBlueprintMismatchError, KeyedSessionConflictError } from './errors'
import { withHook } from './hooks'
import { mount } from './mount'
import { pipe } from './pipe'
import { findKeyedSession } from './resuscitation'
import { select } from './select'
import { update } from './update'

describe('mount', () => {
    it('creates an active session on a physical DOM element', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 0 })

        const session = mount(bp)(el)

        expect(session).toBeDefined()
        expect(session.target).toBe(el)
        expect(session.blueprint).toBe(bp)
        expect(session.isDisposed).toBe(false)
        expect(session.isSuspended).toBe(false)
        expect(session.key).toBeUndefined()
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

    it('resolves, trims, and projects an explicit key and registers the session', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 0 })

        const session = mount(bp, { key: '  cart-panel  ' })(el)

        expect(session.key).toBe('cart-panel')
        expect(el.getAttribute('data-context-key')).toBe('cart-panel')
        expect(findKeyedSession('cart-panel', el.ownerDocument)).toBe(session)
    })

    it('resolves the key from the data-context-key attribute when no option is given', () => {
        const el = document.createElement('div')
        el.setAttribute('data-context-key', 'from-attribute')
        const bp = createContext({ count: 0 })

        const session = mount(bp)(el)
        expect(session.key).toBe('from-attribute')

        const again = mount(bp)(el)
        expect(again).toBe(session)
    })

    it('auto-resuscitates a keyed session onto a new host when the previous host disconnected', () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        const hookCalls: string[] = []
        const events: string[] = []

        el2.addEventListener('context-resuscitate', (e: any) => {
            events.push('resuscitate')
            expect(e.detail.newTarget).toBe(el2)
        })

        const bp = pipe(
            createContext({ count: 0 }),
            withHook('mount', () => {
                hookCalls.push('mount')
            }),
            withHook('resuscitate', () => {
                hookCalls.push('resuscitate')
            })
        )

        const mountPanel = mount(bp, { key: 'panel-auto' })
        const session = mountPanel(el1)
        update<{ count: number }>({ count: 7 })(session)

        const revived = mountPanel(el2)

        expect(revived).toBe(session)
        expect(session.target).toBe(el2)
        expect(select((s: { count: number }) => s.count)(session)).toBe(7)
        expect(hookCalls).toEqual(['mount', 'resuscitate'])
        expect(events).toEqual(['resuscitate'])
    })

    it('throws KeyedSessionConflictError when the previous host is still connected', () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        document.body.appendChild(el1)
        document.body.appendChild(el2)

        const bp = createContext({ count: 0 })
        const mountPanel = mount(bp, { key: 'panel-conflict' })
        const session = mountPanel(el1)

        expect(() => mountPanel(el2)).toThrow(KeyedSessionConflictError)
        expect(session.target).toBe(el1)

        document.body.removeChild(el1)
        document.body.removeChild(el2)
    })

    it('hot-transfers the session to the new host with onConflict evict', () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        document.body.appendChild(el1)
        document.body.appendChild(el2)

        const hookCalls: string[] = []
        const bp = pipe(
            createContext({ count: 3 }),
            withHook('suspend', () => {
                hookCalls.push('suspend')
            }),
            withHook('resuscitate', () => {
                hookCalls.push('resuscitate')
            })
        )

        const mountPanel = mount(bp, { key: 'panel-evict', onConflict: 'evict' })
        const session = mountPanel(el1)
        const transferred = mountPanel(el2)

        expect(transferred).toBe(session)
        expect(session.target).toBe(el2)
        expect(select((s: { count: number }) => s.count)(session)).toBe(3)
        expect(hookCalls).toEqual(['suspend', 'resuscitate'])

        document.body.removeChild(el1)
        document.body.removeChild(el2)
    })

    it('throws KeyedBlueprintMismatchError when the blueprint instance differs', () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        const bpA = createContext({ count: 0 })
        const bpB = createContext({ count: 0 })

        mount(bpA, { key: 'panel-mismatch' })(el1)

        expect(() => mount(bpB, { key: 'panel-mismatch' })(el2)).toThrow(KeyedBlueprintMismatchError)
    })

    it('resets the identity with onConflict reset', () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        const bpA = createContext({ count: 0 })
        const bpB = createContext({ count: 9 })

        const first = mount(bpA, { key: 'panel-reset' })(el1)
        const second = mount(bpB, { key: 'panel-reset', onConflict: 'reset' })(el2)

        expect(second).not.toBe(first)
        expect(first.isDisposed).toBe(true)
        expect(select((s: { count: number }) => s.count)(second)).toBe(9)
        expect(findKeyedSession('panel-reset', el2.ownerDocument)).toBe(second)
    })

    it('throws when remounting the same element with a different blueprint instance', () => {
        const el = document.createElement('div')
        const bpA = createContext({ count: 0 })
        const bpB = createContext({ count: 0 })

        mount(bpA)(el)

        expect(() => mount(bpB)(el)).toThrow(KeyedBlueprintMismatchError)

        const reset = mount(bpB, { onConflict: 'reset' })(el)
        expect(reset.blueprint).toBe(bpB)
    })

    it('keeps anonymous sessions out of the keyed registry', () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        const bp = createContext({ count: 0 })

        const session1 = mount(bp)(el1)
        const session2 = mount(bp)(el2)

        expect(session1).not.toBe(session2)
        expect(session1.key).toBeUndefined()
        expect(findKeyedSession('', el1.ownerDocument)).toBeUndefined()
    })
})
