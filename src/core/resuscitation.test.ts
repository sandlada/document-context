import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createContext } from './context'
import { withHook } from './hooks'
import { mount } from './mount'
import { pipe } from './pipe'
import { select } from './select'
import { subscribe } from './subscribe'
import { update } from './update'
import {
    findKeyedSession,
    resuscitateKeyedSession,
    unregisterKeyedSession
} from './resuscitation'
import { startRootObserver, stopRootObserver, trackElementForGC } from '../dom/observer'

describe('Keyed Identity & Resuscitation API', () => {
    beforeEach(() => {
        startRootObserver(document)
    })

    afterEach(() => {
        stopRootObserver(document)
    })

    it('auto-registers keyed mount sessions and finds them per document', () => {
        const el = document.createElement('div')
        el.setAttribute('data-context-key', 'session-123')

        const bp = createContext({ count: 1 })
        const session = mount(bp)(el)

        expect(findKeyedSession('session-123')).toBe(session)
    })

    it('unregisters the identity and clears the session key', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 1 })
        const session = mount(bp, { key: 'retire-me' })(el)

        unregisterKeyedSession('retire-me', el.ownerDocument)

        expect(findKeyedSession('retire-me', el.ownerDocument)).toBeUndefined()
        expect(session.key).toBeUndefined()
    })

    it('resuscitates a suspended keyed session onto a replacement host', async () => {
        const el1 = document.createElement('div')
        document.body.appendChild(el1)

        let resuscitateFired = false
        const bp = pipe(
            createContext({ score: 10 }),
            withHook('resuscitate', (session, newTarget) => {
                resuscitateFired = true
                expect(newTarget).toBeDefined()
            })
        )

        const session = mount(bp, { key: 'hero-widget', suspensionTtlMs: 2000 })(el1)
        trackElementForGC(el1, session)

        document.body.removeChild(el1)
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

        expect(session.isSuspended).toBe(true)

        const el2 = document.createElement('div')
        document.body.appendChild(el2)

        const resuscitated = resuscitateKeyedSession('hero-widget', el2)

        expect(resuscitated).toBe(session)
        expect(resuscitateFired).toBe(true)
        expect(session.target).toBe(el2)
        expect(session.isSuspended).toBe(false)

        document.body.removeChild(el2)
    })

    it('refuses manual resuscitation while the current host is still connected', () => {
        const el1 = document.createElement('div')
        document.body.appendChild(el1)
        const el2 = document.createElement('div')

        const bp = createContext({ count: 0 })
        const session = mount(bp, { key: 'locked' })(el1)

        const result = resuscitateKeyedSession('locked', el2)

        expect(result).toBeUndefined()
        expect(session.target).toBe(el1)

        document.body.removeChild(el1)
    })

    it('preserves state and emits no replay after resuscitation', async () => {
        const el1 = document.createElement('div')
        document.body.appendChild(el1)

        const bp = createContext({ count: 0 })
        const session = mount(bp, { key: 'counter-panel', suspensionTtlMs: 2000 })(el1)
        trackElementForGC(el1, session)

        document.body.removeChild(el1)
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
        expect(session.isSuspended).toBe(true)

        const emissions: number[] = []
        subscribe((s: { count: number }) => emissions.push(s.count))(session)

        const bump = update<{ count: number }>((s) => ({ count: s.count + 1 }))
        bump(session)
        bump(session)

        expect(select((s: { count: number }) => s.count)(session)).toBe(2)

        const el2 = document.createElement('div')
        document.body.appendChild(el2)
        const resuscitated = resuscitateKeyedSession('counter-panel', el2)
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

        expect(resuscitated).toBe(session)
        expect(select((s: { count: number }) => s.count)(session)).toBe(2)
        // Initial emission plus exactly the two updates; no replay emission.
        expect(emissions).toEqual([0, 1, 2])

        document.body.removeChild(el2)
    })
})
