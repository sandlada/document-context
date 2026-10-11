import { describe, expect, it } from 'vitest'
import { createSessionState } from '../model/session.js'
import { applyUpdate, updateSession } from './update.js'

type Counter = {
    count: number
    theme: string
    nested: { a: number, b: number }
}

const seed = (): Counter => ({ count: 0, theme: 'light', nested: { a: 1, b: 2 } })

describe('applyUpdate with a partial', () => {
    it('shallow-merges top-level keys and keeps nested references', () => {
        const prev = seed()
        const next = applyUpdate(prev, { count: 2 })
        expect(next).toEqual({ count: 2, theme: 'light', nested: { a: 1, b: 2 } })
        expect(next.nested).toBe(prev.nested)
    })

    it('never mutates the previous snapshot', () => {
        const prev = seed()
        const frozen = { ...prev }
        applyUpdate(prev, { count: 5 })
        expect(prev).toEqual(frozen)
    })

    it('replaces nested objects wholesale instead of deep-merging (02 #8)', () => {
        const next = applyUpdate(seed(), { nested: { a: 9 } } as unknown as Partial<Counter>)
        expect(next.nested).toEqual({ a: 9 })
    })

    it('treats an empty partial as a no-op merge with a fresh reference', () => {
        const prev = seed()
        const next = applyUpdate(prev, {})
        expect(next).toEqual(prev)
        expect(next).not.toBe(prev)
    })

    it('never deletes keys: missing keys stay untouched', () => {
        const next = applyUpdate(seed(), { theme: 'dark' })
        expect(next).toEqual({ count: 0, theme: 'dark', nested: { a: 1, b: 2 } })
        expect('count' in next).toBe(true)
    })

    it('is prototype-safe: __proto__ payloads do not pollute Object.prototype (02 #8)', () => {
        const malicious = JSON.parse('{"__proto__":{"polluted":true}}') as Partial<Counter>
        const next = applyUpdate(seed(), malicious)
        expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined()
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
        expect(Object.prototype.hasOwnProperty.call(next, '__proto__')).toBe(true)
    })

    it('ignores undefined values without deleting the key', () => {
        const next = applyUpdate(seed(), { theme: undefined } as unknown as Partial<Counter>)
        expect('theme' in next).toBe(true)
    })
})

describe('applyUpdate with a function', () => {
    it('merges the returned partial against the previous snapshot', () => {
        const next = applyUpdate(seed(), (prev) => ({ count: prev.count + 1 }))
        expect(next).toEqual({ count: 1, theme: 'light', nested: { a: 1, b: 2 } })
    })

    it('applies a full-state return value', () => {
        const next = applyUpdate(seed(), (prev) => ({ ...prev, theme: 'dark' }))
        expect(next.theme).toBe('dark')
        expect(next.count).toBe(0)
    })

    it('passes the live previous snapshot to the updater', () => {
        const prev = seed()
        let seen: Counter | null = null
        applyUpdate(prev, (value: Counter) => {
            seen = value
            return {}
        })
        expect(seen).toBe(prev)
    })
})

describe('updateSession', () => {
    it('applies the update and pushes to state$ when live', () => {
        const store = createSessionState(seed())
        const seen: Array<number> = []
        store.state$.subscribe((state: Counter) => {
            seen.push(state.count)
        })
        expect(updateSession(store, { count: 4 })).toBe(true)
        expect(store.getSnapshot().count).toBe(4)
        expect(seen).toEqual([0, 4])
    })

    it('applies function updaters through applyUpdate', () => {
        const store = createSessionState(seed())
        expect(updateSession(store, (prev) => ({ count: prev.count + 2 }))).toBe(true)
        expect(store.getSnapshot().count).toBe(2)
    })

    it('returns false and keeps the snapshot once poisoned (02 #4)', () => {
        const store = createSessionState(seed())
        store.poison()
        expect(updateSession(store, { count: 9 })).toBe(false)
        expect(store.getSnapshot()).toEqual(seed())
    })

    it('returns false for function updaters once poisoned without running them', () => {
        const store = createSessionState(seed())
        store.poison()
        let calls = 0
        const ok = updateSession(store, (prev) => {
            calls += 1
            return { count: prev.count + 1 }
        })
        expect(ok).toBe(false)
        expect(calls).toBe(0)
    })
})
