import { describe, expect, it } from 'vitest'
import { createSessionState } from './session.js'
import type { LifecycleEvent, Session } from './session.js'

type State = {
    count: number
    theme: string
    nested: { a: number, b: number }
}

const seed = (): State => ({ count: 0, theme: 'light', nested: { a: 1, b: 2 } })

describe('createSessionState', () => {
    it('returns the initial snapshot without aliasing the input', () => {
        const initial = seed()
        const store = createSessionState(initial)
        expect(store.getSnapshot()).toEqual(initial)
        expect(store.getSnapshot()).not.toBe(initial)
        expect(store.isPoisoned()).toBe(false)
    })

    it('exposes a hot state$ that replays the current value to late subscribers', () => {
        const store = createSessionState(seed())
        const first: Array<State> = []
        const second: Array<State> = []
        store.state$.subscribe((state) => {
            first.push(state)
        })
        store.update({ count: 3 })
        store.state$.subscribe((state) => {
            second.push(state)
        })
        expect(first).toEqual([
            { count: 0, theme: 'light', nested: { a: 1, b: 2 } },
            { count: 3, theme: 'light', nested: { a: 1, b: 2 } },
        ])
        expect(second).toEqual([{ count: 3, theme: 'light', nested: { a: 1, b: 2 } }])
    })

    it('setState replaces the whole snapshot and pushes to state$', () => {
        const store = createSessionState(seed())
        const seen: Array<State> = []
        store.state$.subscribe((state) => {
            seen.push(state)
        })
        const next: State = { count: 4, theme: 'dark', nested: { a: 0, b: 0 } }
        store.setState(next)
        expect(store.getSnapshot()).toEqual(next)
        expect(seen).toHaveLength(2)
        expect(seen[1]).toEqual(next)
    })

    it('update with a partial shallow-merges top-level keys and keeps nested refs', () => {
        const initial = seed()
        const store = createSessionState(initial)
        const ok = store.update({ count: 2 })
        expect(ok).toBe(true)
        expect(store.getSnapshot()).toEqual({ count: 2, theme: 'light', nested: { a: 1, b: 2 } })
        expect(store.getSnapshot().nested).toBe(initial.nested)
    })

    it('update with a function merges the returned partial against the previous snapshot', () => {
        const store = createSessionState(seed())
        const ok = store.update((prev) => ({ count: prev.count + 1 }))
        expect(ok).toBe(true)
        expect(store.getSnapshot()).toEqual({ count: 1, theme: 'light', nested: { a: 1, b: 2 } })
    })

    it('update with a function returning a full state applies it', () => {
        const store = createSessionState(seed())
        const ok = store.update((prev) => ({ ...prev, theme: 'dark' }))
        expect(ok).toBe(true)
        expect(store.getSnapshot().theme).toBe('dark')
    })

    it('update never deletes keys: an empty partial is a no-op merge', () => {
        const store = createSessionState(seed())
        expect(store.update({})).toBe(true)
        expect(store.getSnapshot()).toEqual(seed())
    })

    it('update replaces nested objects wholesale instead of deep-merging', () => {
        const store = createSessionState(seed())
        store.update({ nested: { a: 9 } } as unknown as Partial<State>)
        expect(store.getSnapshot().nested).toEqual({ a: 9 })
    })

    it('keeps prior snapshots immutable after later updates', () => {
        const store = createSessionState(seed())
        const before = store.getSnapshot()
        store.update({ count: 7 })
        expect(before).toEqual(seed())
        expect(store.getSnapshot()).not.toBe(before)
    })

    it('uses CreateDataProperty semantics instead of Object.assign (02 #8)', () => {
        const store = createSessionState(seed())
        const malicious = JSON.parse('{"__proto__":{"polluted":true}}') as Partial<State>
        store.update(malicious)
        expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined()
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    it('poison freezes the snapshot and rejects further updates and sets', () => {
        const store = createSessionState(seed())
        store.update({ count: 1 })
        const frozen = store.getSnapshot()
        store.poison()
        expect(store.isPoisoned()).toBe(true)
        expect(store.update({ count: 2 })).toBe(false)
        store.setState({ count: 3, theme: 'dark', nested: { a: 0, b: 0 } })
        expect(store.getSnapshot()).toBe(frozen)
        expect(store.getSnapshot()).toEqual({ count: 1, theme: 'light', nested: { a: 1, b: 2 } })
    })

    it('poison completes state$ for existing subscribers without further emissions', () => {
        const store = createSessionState(seed())
        const seen: Array<number> = []
        let completed = false
        store.state$.subscribe({
            next: (state) => {
                seen.push(state.count)
            },
            complete: () => {
                completed = true
            },
        })
        store.update({ count: 1 })
        store.poison()
        store.setState({ count: 9, theme: 'x', nested: { a: 0, b: 0 } })
        expect(seen).toEqual([0, 1])
        expect(completed).toBe(true)
    })

    it('supports multiple concurrent subscribers', () => {
        const store = createSessionState(seed())
        const left: Array<number> = []
        const right: Array<number> = []
        store.state$.subscribe((state) => {
            left.push(state.count)
        })
        store.state$.subscribe((state) => {
            right.push(state.count)
        })
        store.update({ count: 5 })
        expect(left).toEqual([0, 5])
        expect(right).toEqual([0, 5])
    })

    it('makes poison idempotent: a second call is a no-op that completes state$ once', () => {
        const store = createSessionState(seed())
        let completions = 0
        store.state$.subscribe({
            complete: () => {
                completions += 1
            },
        })
        store.poison()
        const frozen = store.getSnapshot()
        store.poison()
        expect(store.isPoisoned()).toBe(true)
        expect(store.getSnapshot()).toBe(frozen)
        expect(completions).toBe(1)
        expect(store.update({ count: 9 })).toBe(false)
    })
})

describe('LifecycleEvent', () => {
    it('covers mounted, suspended, resuscitated, adopted, and disposed', () => {
        const events: Array<LifecycleEvent> = [
            { type: 'mounted' },
            { type: 'suspended' },
            { type: 'resuscitated' },
            { type: 'adopted', owner: { id: 1 } },
            { type: 'disposed' },
        ]
        expect(events.map((event) => event.type)).toEqual([
            'mounted',
            'suspended',
            'resuscitated',
            'adopted',
            'disposed',
        ])
        const adopted = events[3]
        if (adopted !== undefined && adopted.type === 'adopted') {
            expect(adopted.owner).toEqual({ id: 1 })
        } else {
            throw new Error('expected the adopted event at index 3')
        }
    })

    it('is exhaustively matchable over every variant', () => {
        const label = (event: LifecycleEvent): string => {
            switch (event.type) {
                case 'mounted':
                    return 'mounted'
                case 'suspended':
                    return 'suspended'
                case 'resuscitated':
                    return 'resuscitated'
                case 'adopted':
                    return `adopted:${typeof event.owner}`
                case 'disposed':
                    return 'disposed'
                default: {
                    const remaining: never = event
                    return remaining
                }
            }
        }
        expect(label({ type: 'mounted' })).toBe('mounted')
        expect(label({ type: 'adopted', owner: null })).toBe('adopted:object')
        expect(label({ type: 'disposed' })).toBe('disposed')
    })
})

describe('Session', () => {
    it('is a branded handle that cannot be fabricated outside mount (type-level)', () => {
        const impostor = { token: null }
        // @ts-expect-error - Session carries a module-local brand plus required streams
        const session: Session = impostor
        expect(session).toBeDefined()
    })
})
