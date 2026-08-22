import { describe, expect, it, vi } from 'vitest'
import { createContext } from './context'
import { withHook } from './hooks'
import { mount } from './mount'
import { pipe } from './pipe'
import { select } from './select'
import { update } from './update'
import {
    registerKeyedSession,
    findKeyedSession,
    resuscitateKeyedSession
} from './resuscitation'

describe('Keyed Identity & 50ms Resuscitation State Machine', () => {
    it('registers and finds a keyed session by data-context-key', () => {
        const el = document.createElement('div')
        el.setAttribute('data-context-key', 'session-123')

        const bp = createContext({ count: 1 })
        const session = mount(bp)(el)
        registerKeyedSession('session-123', session)

        expect(findKeyedSession('session-123')).toBe(session)
    })

    it('resuscitates a suspended keyed session and executes resuscitate hook', () => {
        const el1 = document.createElement('div')
        el1.setAttribute('data-context-key', 'hero-widget')

        let resuscitateFired = false
        const bp = pipe(
            createContext({ score: 10 }),
            withHook('resuscitate', (session, newTarget) => {
                resuscitateFired = true
                expect(newTarget).toBeDefined()
            })
        )

        const session = mount(bp)(el1)
        registerKeyedSession('hero-widget', session)

        // New DOM element replaces old one
        const el2 = document.createElement('div')
        el2.setAttribute('data-context-key', 'hero-widget')

        const resuscitated = resuscitateKeyedSession('hero-widget', el2)
        expect(resuscitated).toBe(session)
        expect(resuscitateFired).toBe(true)
    })
})
