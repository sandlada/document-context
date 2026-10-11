import { describe, expect, it } from 'vitest'
import type { ContextBlueprint } from '../../domain/index.js'
import type { StorageOptions } from '../../domain/index.js'
import { persist } from './persist.js'
import { createFakeStorage } from '../../domain/testing/fakes.js'

interface CounterState extends Record<PropertyKey, unknown> {
    count: number
}

const seedBlueprint = (): ContextBlueprint<CounterState> => ({
    initial: { count: 0 },
    providers: new Map(),
    hooks: [],
    storage: null,
})

describe('persist', () => {
    it('sets storage on a new blueprint without touching the input', () => {
        const before = seedBlueprint()
        const options: StorageOptions<CounterState> = { storage: 'localStorage', key: 'counter' }
        const after = persist(options)(before)
        expect(before.storage).toBeNull()
        expect(after).not.toBe(before)
        expect(after.storage).toEqual({ storage: 'localStorage', key: 'counter' })
    })

    it('accepts a custom storage port', () => {
        const handle = createFakeStorage()
        const after = persist<CounterState>({ storage: handle.port, key: 'counter' })(seedBlueprint())
        expect(after.storage?.storage).toBe(handle.port)
        expect(after.storage?.key).toBe('counter')
    })

    it('preserves initial state, providers, and hooks by structural sharing', () => {
        const before = seedBlueprint()
        const after = persist({ storage: 'localStorage', key: 'counter' })(before)
        expect(after.initial).toBe(before.initial)
        expect(after.providers).toBe(before.providers)
        expect(after.hooks).toBe(before.hooks)
    })

    it('overrides storage when applied repeatedly', () => {
        const once = persist<CounterState>({ storage: 'localStorage', key: 'first' })(seedBlueprint())
        const twice = persist<CounterState>({ storage: 'sessionStorage', key: 'second' })(once)
        expect(once.storage?.key).toBe('first')
        expect(twice.storage).toEqual({ storage: 'sessionStorage', key: 'second' })
    })

    it('carries every storage option through untouched', () => {
        const options: StorageOptions<CounterState> = {
            storage: 'localStorage',
            key: 'counter',
            hydration: 'merge',
            version: 3,
            migrate: (persisted) => ({ count: (persisted as { count: number }).count }),
            crossTab: false,
            conflict: 'ignore-external',
        }
        const after = persist(options)(seedBlueprint())
        expect(after.storage).toEqual(options)
        expect(after.storage).not.toBe(options)
    })

    it('snapshots options so later caller mutations cannot leak in', () => {
        const options: StorageOptions<CounterState> = { storage: 'localStorage', key: 'counter' }
        const after = persist(options)(seedBlueprint())
        expect(after.storage?.key).toBe('counter')
    })
})
