import { describe, expect, it, vi } from 'vitest'
import { createContext } from './context'
import { mount } from './mount'
import { update } from './update'
import { subscribe } from './subscribe'

describe('subscribe', () => {
    it('immediately emits the initial state snapshot on subscribe', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 100 })
        const session = mount(bp)(el)

        const listener = vi.fn()
        const unsubscribe = subscribe(listener)(session)

        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith({ count: 100 })

        unsubscribe()
    })

    it('emits state updates to listener on each update call', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 0 })
        const session = mount(bp)(el)

        const values: number[] = []
        const unsubscribe = subscribe((s: { count: number }) => values.push(s.count))(session)

        update<{ count: number }>({ count: 1 })(session)
        update<{ count: number }>({ count: 2 })(session)

        expect(values).toEqual([0, 1, 2])

        unsubscribe()
    })

    it('stops emitting after unsubscribe is called', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 0 })
        const session = mount(bp)(el)

        const values: number[] = []
        const unsubscribe = subscribe((s: { count: number }) => values.push(s.count))(session)

        update<{ count: number }>({ count: 1 })(session)
        unsubscribe()
        update<{ count: number }>({ count: 2 })(session)

        expect(values).toEqual([0, 1])
    })
})
