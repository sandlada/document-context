import { describe, expect, it } from 'vitest'
import { createContext } from '../core/context'
import { mount } from '../core/mount'
import { update } from '../core/update'
import { toSignal } from './to-signal'

describe('toSignal TC39 Signals interop', () => {
    it('creates a signal with a get() method that reads state snapshot', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 10, title: 'signals' })
        const session = mount(bp)(el)

        const countSignal = toSignal(session, (s) => s.count)

        expect(countSignal).toBeDefined()
        expect(countSignal.get()).toBe(10)
    })

    it('updates signal value reactively upon session state changes', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 0 })
        const session = mount(bp)(el)

        const countSignal = toSignal(session, (s) => s.count)
        expect(countSignal.get()).toBe(0)

        update<{ count: number }>({ count: 42 })(session)
        expect(countSignal.get()).toBe(42)

        update<{ count: number }>({ count: 99 })(session)
        expect(countSignal.get()).toBe(99)
    })
})
