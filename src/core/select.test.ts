import { describe, expect, it } from 'vitest'
import { createContext } from './context'
import { mount } from './mount'
import { select } from './select'

describe('select', () => {
    it('synchronously reads a state snapshot using selector', () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 42, user: { name: 'Alice' } })
        const session = mount(bp)(el)

        const selectCount = select((s: typeof bp.initialState) => s.count)
        const selectName = select((s: typeof bp.initialState) => s.user.name)

        expect(selectCount(session)).toBe(42)
        expect(selectName(session)).toBe('Alice')
    })

    it('returns frozen state slice in development mode', () => {
        const originalEnv = process.env.NODE_ENV
        try {
            process.env.NODE_ENV = 'development'
            const el = document.createElement('div')
            const bp = createContext({ nested: { foo: 'bar' } })
            const session = mount(bp)(el)

            const selectNested = select((s: typeof bp.initialState) => s.nested)
            const result = selectNested(session)

            expect(Object.isFrozen(result)).toBe(true)
        } finally {
            process.env.NODE_ENV = originalEnv
        }
    })
})
