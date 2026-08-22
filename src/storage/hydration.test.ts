import { describe, expect, it } from 'vitest'
import { resolveHydratedState } from './hydration'
import { createContext } from '../core/context'
import { withBridge } from '../bridge/with-bridge'
import { pipe } from '../core/pipe'

describe('Storage Hydration Precedence', () => {
    it('resolves state using storageFirst precedence (Storage > DOM > Blueprint)', () => {
        const el = document.createElement('div')
        el.dataset.count = '20' // DOM value

        const bp = pipe(
            createContext({ count: 10 }),
            withBridge({ properties: { count: 'dataset.count' } })
        )

        const storageData = { count: 30 } // Storage value

        const hydrated = resolveHydratedState(bp, el, storageData, 'storageFirst')
        expect(hydrated.count).toBe(30)
    })

    it('resolves state using domFirst precedence (DOM > Storage > Blueprint)', () => {
        const el = document.createElement('div')
        el.dataset.theme = 'neon' // DOM value

        const bp = pipe(
            createContext({ theme: 'light' }),
            withBridge({ properties: { theme: 'dataset.theme' } })
        )

        const storageData = { theme: 'dark' } // Storage value

        const hydrated = resolveHydratedState(bp, el, storageData, 'domFirst')
        expect(hydrated.theme).toBe('neon')
    })

    it('resolves state using blueprintFirst precedence (Blueprint > Storage > DOM)', () => {
        const el = document.createElement('div')
        el.dataset.count = '50'

        const bp = pipe(
            createContext({ count: 5 }),
            withBridge({ properties: { count: 'dataset.count' } })
        )

        const storageData = { count: 99 }

        const hydrated = resolveHydratedState(bp, el, storageData, 'blueprintFirst')
        expect(hydrated.count).toBe(5)
    })

    it('resolves state using merge precedence combining all layers', () => {
        const el = document.createElement('div')
        el.dataset.c = '3'

        const bp = pipe(
            createContext({ a: 1, b: 1, c: 1 }),
            withBridge({ properties: { c: 'dataset.c' } })
        )

        const storageData = { b: 2 }

        const hydrated = resolveHydratedState(bp, el, storageData, 'merge')
        expect(hydrated).toEqual({ a: 1, b: 2, c: '3' })
    })
})
