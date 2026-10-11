import { describe, expect, it } from 'vitest'
import { createContext } from './create-context.js'

describe('createContext', () => {
    it('stores the initial state as-is without copying', () => {
        const initial = { count: 0 }
        const blueprint = createContext(initial)
        expect(blueprint.initial).toBe(initial)
    })

    it('keeps nested references shared (no deep copy or deep freeze)', () => {
        const nested = { theme: 'dark' }
        const blueprint = createContext({ nested })
        expect(blueprint.initial.nested).toBe(nested)
    })

    it('starts with an empty provider map, no hooks, and null storage', () => {
        const blueprint = createContext({ count: 0 })
        expect(blueprint.providers).toBeInstanceOf(Map)
        expect(blueprint.providers.size).toBe(0)
        expect(blueprint.hooks).toEqual([])
        expect(blueprint.storage).toBeNull()
    })

    it('returns a fresh blueprint object on every call', () => {
        const initial = { count: 0 }
        const first = createContext(initial)
        const second = createContext(initial)
        expect(first).not.toBe(second)
        expect(first).toEqual(second)
    })

    it('does not mutate the supplied initial object', () => {
        const initial = { count: 0 }
        createContext(initial)
        expect(initial).toEqual({ count: 0 })
    })

    it('preserves the state shape through the blueprint', () => {
        const blueprint = createContext({ count: 0, user: null as { id: string } | null })
        expect(blueprint.initial).toEqual({ count: 0, user: null })
    })
})
