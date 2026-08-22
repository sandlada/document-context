import { describe, expect, it, beforeEach } from 'vitest'
import { createContext } from '../core/context'
import { mount } from '../core/mount'
import { pipe } from '../core/pipe'
import { select } from '../core/select'
import { update } from '../core/update'
import { withStorage } from './with-storage'
import { getStorageInstance } from './adapters'

describe('withStorage operator & persistence lifecycle', () => {
    beforeEach(() => {
        getStorageInstance('localStorage').clear()
    })

    it('attaches storage options immutably onto blueprint', () => {
        const bp = createContext({ count: 0 })
        const enriched = withStorage({
            adapter: 'localStorage',
            key: 'app-counter'
        })(bp)

        expect(enriched.storage).toBeDefined()
        expect(enriched.storage?.key).toBe('app-counter')
        expect(bp.storage).toBeUndefined()
    })

    it('hydrates initial state from localStorage on mount and persists state updates', async () => {
        getStorageInstance('localStorage').setItem(
            'counter-key',
            JSON.stringify({ __v: 1, data: { count: 88 } })
        )

        const el = document.createElement('div')
        const bp = pipe(
            createContext({ count: 0 }),
            withStorage({
                adapter: 'localStorage',
                key: 'counter-key',
                version: 1
            })
        )

        const session = mount(bp)(el)

        expect(select((s: { count: number }) => s.count)(session)).toBe(88)

        update<{ count: number }>({ count: 99 })(session)

        const rawStored = getStorageInstance('localStorage').getItem('counter-key')
        expect(rawStored).toBeDefined()
        const parsed = JSON.parse(rawStored!)
        expect(parsed.data).toEqual({ count: 99 })
    })
})
