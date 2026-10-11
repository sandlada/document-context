import { describe, expect, it } from 'vitest'
import { collectAncestors, nearestProvider, orderEntries, orderProviders } from './scope.js'
import type { HostPort } from '../ports/host.js'
import type { ScopedEntry, ScopeDirection } from './scope.js'

interface FakeHost {
    readonly name: string
    readonly parent: FakeHost | null
}

const toPort = (host: FakeHost): HostPort<unknown> => host as unknown as HostPort<unknown>

const buildChain = (): { root: FakeHost, mid: FakeHost, leaf: FakeHost } => {
    const root: FakeHost = { name: 'root', parent: null }
    const mid: FakeHost = { name: 'mid', parent: root }
    const leaf: FakeHost = { name: 'leaf', parent: mid }
    return { root, mid, leaf }
}

const names = (hosts: ReadonlyArray<HostPort<unknown>>): Array<string> =>
    hosts.map((host) => (host as unknown as FakeHost).name)

describe('collectAncestors', () => {
    it('walks the parent chain bottom-up starting with the host itself', () => {
        const { root, mid, leaf } = buildChain()
        const chain = collectAncestors(toPort(leaf))
        expect(chain).toHaveLength(3)
        expect(names(chain)).toEqual(['leaf', 'mid', 'root'])
        expect(chain[0]).toBe(toPort(leaf) as unknown as object)
        expect(names([chain[1] as HostPort<unknown>])).toEqual([(mid as FakeHost).name])
        expect(names([chain[2] as HostPort<unknown>])).toEqual([(root as FakeHost).name])
    })

    it('returns a single entry for a root host', () => {
        const { root } = buildChain()
        const chain = collectAncestors(toPort(root))
        expect(chain).toHaveLength(1)
        expect(names(chain)).toEqual(['root'])
    })

    it('returns a fresh array on every call', () => {
        const { leaf } = buildChain()
        const first = collectAncestors(toPort(leaf))
        const second = collectAncestors(toPort(leaf))
        expect(first).not.toBe(second)
        expect(first).toEqual(second)
    })
})

describe('nearestProvider', () => {
    it('returns the first bottom-up match so the nearest scope wins', () => {
        const { leaf } = buildChain()
        const chain = collectAncestors(toPort(leaf))
        const found = nearestProvider(chain, (host) => {
            const name = (host as unknown as FakeHost).name
            return name === 'mid' || name === 'root'
        })
        expect(found).not.toBeNull()
        expect(names(found === null ? [] : [found])).toEqual(['mid'])
    })

    it('passes the bottom-up index to the predicate', () => {
        const { leaf } = buildChain()
        const chain = collectAncestors(toPort(leaf))
        const seen: Array<number> = []
        nearestProvider(chain, (_host, index) => {
            seen.push(index)
            return false
        })
        expect(seen).toEqual([0, 1, 2])
    })

    it('returns null when nothing matches or the chain is empty', () => {
        const { leaf } = buildChain()
        const chain = collectAncestors(toPort(leaf))
        expect(nearestProvider(chain, () => false)).toBeNull()
        expect(nearestProvider([], () => true)).toBeNull()
    })

    it('composes with collectAncestors end to end', () => {
        const { leaf } = buildChain()
        const found = nearestProvider(collectAncestors(toPort(leaf)), (host) => (
            (host as unknown as FakeHost).name === 'leaf'
        ))
        expect(found).not.toBeNull()
        expect(names(found === null ? [] : [found])).toEqual(['leaf'])
    })
})

describe('orderEntries', () => {
    it('sorts nearest-first for bottomUp and farthest-first for topDown', () => {
        const bottomUp: ScopeDirection = 'bottomUp'
        const topDown: ScopeDirection = 'topDown'
        const entries: Array<ScopedEntry<string>> = [
            { value: 'far', depth: 2, order: 0 },
            { value: 'near', depth: 0, order: 0 },
            { value: 'mid', depth: 1, order: 0 },
        ]
        expect(orderEntries(entries, bottomUp).map((entry) => entry.value)).toEqual(['near', 'mid', 'far'])
        expect(orderEntries(entries, topDown).map((entry) => entry.value)).toEqual(['far', 'mid', 'near'])
    })

    it('breaks same-depth ties by registration order, not by input reversal', () => {
        const tied: Array<ScopedEntry<string>> = [
            { value: 'second', depth: 1, order: 1 },
            { value: 'first', depth: 1, order: 0 },
        ]
        expect(orderEntries(tied, 'bottomUp').map((entry) => entry.value)).toEqual(['first', 'second'])
        expect(orderEntries(tied, 'topDown').map((entry) => entry.value)).toEqual(['first', 'second'])
    })

    it('keeps depth primary and order secondary in mixed entries', () => {
        const entries: Array<ScopedEntry<string>> = [
            { value: 'deep-first', depth: 2, order: 0 },
            { value: 'shallow-second', depth: 0, order: 1 },
            { value: 'shallow-first', depth: 0, order: 0 },
            { value: 'deep-second', depth: 2, order: 1 },
        ]
        expect(orderEntries(entries, 'bottomUp').map((entry) => entry.value)).toEqual([
            'shallow-first',
            'shallow-second',
            'deep-first',
            'deep-second',
        ])
        expect(orderEntries(entries, 'topDown').map((entry) => entry.value)).toEqual([
            'deep-first',
            'deep-second',
            'shallow-first',
            'shallow-second',
        ])
    })

    it('does not mutate the input array', () => {
        const entries: ReadonlyArray<ScopedEntry<string>> = Object.freeze([
            { value: 'b', depth: 1, order: 1 },
            { value: 'a', depth: 0, order: 0 },
        ])
        const sorted = orderEntries(entries, 'bottomUp')
        expect(sorted.map((entry) => entry.value)).toEqual(['a', 'b'])
        expect(entries.map((entry) => entry.value)).toEqual(['b', 'a'])
    })

    it('handles the empty entry list', () => {
        expect(orderEntries([], 'bottomUp')).toEqual([])
        expect(orderEntries([], 'topDown')).toEqual([])
    })
})

describe('orderProviders', () => {
    it('shares the orderEntries semantics for both directions', () => {
        expect(orderProviders).toBe(orderEntries)
        const entries: Array<ScopedEntry<string>> = [
            { value: 'far', depth: 2, order: 0 },
            { value: 'near', depth: 0, order: 0 },
        ]
        expect(orderProviders(entries, 'bottomUp')).toEqual(orderEntries(entries, 'bottomUp'))
        expect(orderProviders(entries, 'topDown')).toEqual(orderEntries(entries, 'topDown'))
    })
})
