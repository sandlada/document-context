import { describe, expect, it } from 'vitest'
import { createContext } from './context'
import { withHook } from './hooks'
import { mount } from './mount'
import { pipe } from './pipe'
import { getElementSession } from './session-internal'
import { resuscitateSession, suspendSession } from './keyed-lifecycle'

describe('keyed-lifecycle', () => {
    it('parks a keyed session, runs suspend hooks, and dispatches context-suspend', () => {
        const el = document.createElement('div')
        const calls: string[] = []
        let detail: any = null
        el.addEventListener('context-suspend', (e: any) => {
            detail = e.detail
        })

        const bp = pipe(
            createContext({ count: 0 }),
            withHook('suspend', () => {
                calls.push('suspend')
            })
        )
        const session = mount(bp, { key: 'lifecycle-suspend', suspensionTtlMs: 500 })(el)

        const parked = suspendSession(session)

        expect(parked).toBe(true)
        expect(session.isSuspended).toBe(true)
        expect(calls).toEqual(['suspend'])
        expect(detail).toEqual({ sessionKey: 'lifecycle-suspend', ttl: 500 })
        expect(getElementSession(el)).toBeUndefined()

        // Second park is a no-op
        expect(suspendSession(session)).toBe(false)

        resuscitateSession(session, el)
        expect(session.isSuspended).toBe(false)
    })

    it('does not park anonymous sessions', () => {
        const el = document.createElement('div')
        const session = mount(createContext({}))(el)

        expect(suspendSession(session)).toBe(false)
        expect(session.isSuspended).toBe(false)
    })

    it('disposes immediately when suspensionTtlMs is 0', () => {
        const el = document.createElement('div')
        const session = mount(createContext({}), {
            key: 'lifecycle-zero',
            suspensionTtlMs: 0
        })(el)

        expect(suspendSession(session)).toBe(false)
        expect(session.isDisposed).toBe(true)
    })

    it('repoints the target, cancels the timer, and runs resuscitate hooks + event', async () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        const calls: string[] = []
        let eventFired = false
        el2.addEventListener('context-resuscitate', () => {
            eventFired = true
        })

        const bp = pipe(
            createContext({ count: 1 }),
            withHook('resuscitate', () => {
                calls.push('resuscitate')
            })
        )
        const session = mount(bp, { key: 'lifecycle-revive', suspensionTtlMs: 10 })(el1)
        suspendSession(session)

        resuscitateSession(session, el2)

        expect(session.target).toBe(el2)
        expect(session.isSuspended).toBe(false)
        expect(calls).toEqual(['resuscitate'])
        expect(eventFired).toBe(true)
        expect(getElementSession(el2)).toBe(session)

        // The TTL timer was cancelled: waiting past it must not dispose
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect(session.isDisposed).toBe(false)
    })

    it('no-ops on disposed sessions', () => {
        const el = document.createElement('div')
        const session = mount(createContext({}), { key: 'lifecycle-disposed' })(el)
        session[Symbol.dispose]()

        expect(() => resuscitateSession(session, document.createElement('div'))).not.toThrow()
        expect(suspendSession(session)).toBe(false)
    })
})
