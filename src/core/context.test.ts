import { describe, expect, it } from 'vitest'
import { createContext } from './context'
import type { IContextBlueprint } from './types'

describe('createContext', () => {
    it('creates a pure blueprint with initial state', () => {
        const initialState = { count: 0, title: 'test' }
        const blueprint = createContext(initialState)

        expect(blueprint).toBeDefined()
        expect(blueprint.initialState).toEqual({ count: 0, title: 'test' })
        expect(blueprint.providers).toBeInstanceOf(Map)
        expect(blueprint.providers.size).toBe(0)
        expect(blueprint.bridges).toEqual([])
        expect(blueprint.hooks).toEqual([])
        expect(blueprint.storage).toBeUndefined()
    })

    it('freezes initial state in non-production environment', () => {
        const originalEnv = process.env.NODE_ENV
        try {
            process.env.NODE_ENV = 'development'
            const blueprint = createContext({ count: 10, nested: { value: 'immutable' } })

            expect(Object.isFrozen(blueprint.initialState)).toBe(true)
            expect(() => {
                // @ts-expect-error mutating frozen state
                blueprint.initialState.count = 20
            }).toThrow()
        } finally {
            process.env.NODE_ENV = originalEnv
        }
    })

    it('preserves prototype-free or complex initial state structures', () => {
        const nullProto = Object.create(null)
        nullProto.key = 'value'
        const blueprint = createContext(nullProto)

        expect(blueprint.initialState.key).toBe('value')
    })

    it('ensures zero DOM access or side-effects during blueprint creation', () => {
        const bp1 = createContext({ a: 1 })
        const bp2 = createContext({ b: 2 })

        expect(bp1).not.toBe(bp2)
        expect(bp1.initialState).toEqual({ a: 1 })
        expect(bp2.initialState).toEqual({ b: 2 })
    })
})
