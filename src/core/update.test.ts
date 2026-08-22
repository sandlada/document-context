import { describe, expect, it } from 'vitest'
import { createContext } from './context'
import { mount } from './mount'
import { select } from './select'
import { update } from './update'
import { dispose } from './dispose'

describe('update', () => {
    it('updates state with partial state object', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 0, text: 'hello' })
        const session = mount(bp)(el)

        const success = update<{ count: number; text: string }>({ count: 1 })(session)

        expect(success).toBe(true)
        expect(select((s: { count: number; text: string }) => s.count)(session)).toBe(1)
        expect(select((s: { count: number; text: string }) => s.text)(session)).toBe('hello')
    })

    it('updates state with updater function', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 10 })
        const session = mount(bp)(el)

        const increment = update<{ count: number }>((s) => ({ count: s.count + 5 }))
        const success = increment(session)

        expect(success).toBe(true)
        expect(select((s: { count: number }) => s.count)(session)).toBe(15)
    })

    it('safely performs silent No-op returning false when session is disposed', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 0 })
        const session = mount(bp)(el)

        dispose(session)

        const success = update<{ count: number }>({ count: 99 })(session)
        expect(success).toBe(false)
    })
})
