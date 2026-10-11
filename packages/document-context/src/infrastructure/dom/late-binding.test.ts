import { describe, expect, it, vi } from 'vitest'
import { EMPTY } from 'rxjs'
import { createPendingRegistry } from './late-binding.js'
import type { HostPort } from '../../domain/ports/host.js'
import type { Token } from '../../domain/model/token.js'
import type { PendingWake } from './scope-transport.js'

const stubHost = (nativeValue: unknown): HostPort => ({
    token: null,
    isConnected: true,
    parent: null,
    lifecycle$: EMPTY,
    on: () => () => {},
    native: () => nativeValue,
})

const flushTasks = async (rounds = 1): Promise<void> => {
    for (let round = 0; round < rounds; round += 1) {
        await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 0)
        })
    }
}

describe('createPendingRegistry', () => {
    it('runs retries on the next microtask after wakeAll', async () => {
        const registry = createPendingRegistry()
        const retry = vi.fn()
        registry.add({ token: 'app:theme', host: stubHost({}), retry })
        expect(retry).not.toHaveBeenCalled()
        registry.wakeAll()
        await flushTasks()
        expect(retry).toHaveBeenCalledTimes(1)
    })

    it('removeFn stops future retries', async () => {
        const registry = createPendingRegistry()
        const retry = vi.fn()
        const remove = registry.add({ token: 'app:theme', host: stubHost({}), retry })
        remove()
        remove()
        expect(registry.size()).toBe(0)
        registry.wakeAll()
        await flushTasks()
        expect(retry).not.toHaveBeenCalled()
    })

    it('prune drops explicitly removed entries and keeps live ones', () => {
        const registry = createPendingRegistry()
        const keep = registry.add({ token: 'app:keep', host: stubHost({}), retry: () => {} })
        void keep
        const drop = registry.add({ token: 'app:drop', host: stubHost({}), retry: () => {} })
        expect(registry.size()).toBe(2)
        drop()
        expect(registry.prune()).toBe(0)
        expect(registry.size()).toBe(1)
    })

    it('wakeSubtree retries only entries whose host sits in the mounted subtree', async () => {
        const container = document.createElement('div')
        const inside = document.createElement('span')
        const outside = document.createElement('span')
        container.appendChild(inside)
        document.body.appendChild(container)
        document.body.appendChild(outside)
        try {
            const registry = createPendingRegistry()
            const insideRetry = vi.fn()
            const outsideRetry = vi.fn()
            registry.add({ token: 'app:theme', host: stubHost(inside), retry: insideRetry })
            registry.add({ token: 'app:theme', host: stubHost(outside), retry: outsideRetry })
            registry.wakeSubtree(stubHost(container))
            await flushTasks()
            expect(insideRetry).toHaveBeenCalledTimes(1)
            expect(outsideRetry).not.toHaveBeenCalled()
        } finally {
            container.remove()
            outside.remove()
        }
    })

    it('wakeSubtree includes the mounted host itself (self or descendant)', async () => {
        const container = document.createElement('div')
        document.body.appendChild(container)
        try {
            const registry = createPendingRegistry()
            const retry = vi.fn()
            registry.add({ token: 'app:theme', host: stubHost(container), retry })
            registry.wakeSubtree(stubHost(container))
            await flushTasks()
            expect(retry).toHaveBeenCalledTimes(1)
        } finally {
            container.remove()
        }
    })

    it('wakeSubtree filters string tokens by providedTokens (token-bucket fast path)', async () => {
        const container = document.createElement('div')
        const inside = document.createElement('span')
        container.appendChild(inside)
        document.body.appendChild(container)
        try {
            const registry = createPendingRegistry()
            const retryA = vi.fn()
            const retryB = vi.fn()
            registry.add({ token: 'app:a', host: stubHost(inside), retry: retryA })
            registry.add({ token: 'app:b', host: stubHost(inside), retry: retryB })
            registry.wakeSubtree(stubHost(container), ['app:a'])
            await flushTasks()
            expect(retryA).toHaveBeenCalledTimes(1)
            expect(retryB).not.toHaveBeenCalled()
        } finally {
            container.remove()
        }
    })

    it('wakeSubtree still scans private-token entries when providedTokens is present', async () => {
        const container = document.createElement('div')
        const inside = document.createElement('span')
        container.appendChild(inside)
        document.body.appendChild(container)
        try {
            const registry = createPendingRegistry()
            const retry = vi.fn()
            const secret: Token = { name: 'app:secret' }
            registry.add({ token: secret, host: stubHost(inside), retry })
            registry.wakeSubtree(stubHost(container), ['app:unrelated'])
            await flushTasks()
            expect(retry).toHaveBeenCalledTimes(1)
        } finally {
            container.remove()
        }
    })

    it('wakeAll without providedTokens retries every pending entry (whole-document fallback)', async () => {
        const first = document.createElement('div')
        const second = document.createElement('div')
        document.body.appendChild(first)
        document.body.appendChild(second)
        try {
            const registry = createPendingRegistry()
            const retryA = vi.fn()
            const retryB = vi.fn()
            registry.add({ token: 'app:a', host: stubHost(first), retry: retryA })
            registry.add({ token: 'app:b', host: stubHost(second), retry: retryB })
            registry.wakeAll()
            await flushTasks()
            expect(retryA).toHaveBeenCalledTimes(1)
            expect(retryB).toHaveBeenCalledTimes(1)
        } finally {
            first.remove()
            second.remove()
        }
    })

    it('evicts the oldest entry first past maxPending and notifies via onEvict', async () => {
        const evicted: Array<string> = []
        const registry = createPendingRegistry({ maxPending: 2 })
        const retryOldest = vi.fn()
        const retryMiddle = vi.fn()
        const retryNewest = vi.fn()
        registry.add({
            token: 'app:oldest',
            host: stubHost({}),
            retry: retryOldest,
            onEvict: () => {
                evicted.push('app:oldest')
            },
        })
        registry.add({ token: 'app:middle', host: stubHost({}), retry: retryMiddle })
        registry.add({ token: 'app:newest', host: stubHost({}), retry: retryNewest })
        expect(registry.size()).toBe(2)
        expect(evicted).toEqual(['app:oldest'])
        registry.wakeAll()
        await flushTasks()
        expect(retryOldest).not.toHaveBeenCalled()
        expect(retryMiddle).toHaveBeenCalledTimes(1)
        expect(retryNewest).toHaveBeenCalledTimes(1)
    })

    it('drops entries whose abort signal fires, without invoking onEvict', async () => {
        const registry = createPendingRegistry()
        const retry = vi.fn()
        const onEvict = vi.fn()
        const controller = new AbortController()
        registry.add({ token: 'app:theme', host: stubHost({}), retry, onEvict, signal: controller.signal })
        expect(registry.size()).toBe(1)
        controller.abort()
        expect(registry.size()).toBe(0)
        expect(onEvict).not.toHaveBeenCalled()
        registry.wakeAll()
        await flushTasks()
        expect(retry).not.toHaveBeenCalled()
    })

    it('ignores add when the signal is already aborted', () => {
        const registry = createPendingRegistry()
        const controller = new AbortController()
        controller.abort()
        registry.add({ token: 'app:theme', host: stubHost({}), retry: () => {}, signal: controller.signal })
        expect(registry.size()).toBe(0)
    })

    it('chains overflow batches across microtasks in FIFO order', async () => {
        const registry = createPendingRegistry({ maxBatch: 2 })
        const order: Array<number> = []
        for (let index = 0; index < 5; index += 1) {
            const captured = index
            registry.add({ token: 'app:theme', host: stubHost({}), retry: () => {
                order.push(captured)
            } })
        }
        registry.wakeAll()
        await flushTasks(3)
        expect(order).toEqual([0, 1, 2, 3, 4])
    })

    it('retryAll drains matching retries synchronously and reports the count', () => {
        const registry = createPendingRegistry()
        const retryA = vi.fn()
        const retryB = vi.fn()
        const retryOther = vi.fn()
        registry.add({ token: 'app:a', host: stubHost({}), retry: retryA })
        registry.add({ token: 'app:a', host: stubHost({}), retry: retryB })
        registry.add({ token: 'app:other', host: stubHost({}), retry: retryOther })
        expect(registry.retryAll('app:a')).toBe(2)
        expect(retryA).toHaveBeenCalledTimes(1)
        expect(retryB).toHaveBeenCalledTimes(1)
        expect(retryOther).not.toHaveBeenCalled()
        expect(registry.retryAll('app:missing')).toBe(0)
    })

    it('arms a prune-only microtask past the high-water mark without dispatching retries', async () => {
        const events: Array<unknown> = []
        const registry = createPendingRegistry({ maxPending: 10, highWaterMark: 2, onEvent: (event) => {
            events.push(event)
        } })
        const retry = vi.fn()
        registry.add({ token: 'app:a', host: stubHost({}), retry })
        registry.add({ token: 'app:b', host: stubHost({}), retry })
        registry.add({ token: 'app:c', host: stubHost({}), retry })
        await flushTasks()
        expect(retry).not.toHaveBeenCalled()
        expect(events.length).toBeGreaterThan(0)
    })

    it('reports overflow through the dev ledger with token samples and no values', () => {
        interface LedgerShape {
            readonly kind: string
            readonly count: number
            readonly oldestAgeMs: number
            readonly tokens: ReadonlyArray<string>
        }
        const events: Array<LedgerShape> = []
        const registry = createPendingRegistry({ maxPending: 1, onEvent: (event) => {
            events.push(event)
        } })
        registry.add({ token: 'app:first', host: stubHost({}), retry: () => {} })
        registry.add({ token: 'app:second', host: stubHost({}), retry: () => {} })
        expect(events.length).toBeGreaterThan(0)
        const overflow = events[events.length - 1] as LedgerShape
        expect(overflow.kind).toBe('overflow')
        expect(overflow.count).toBeGreaterThan(0)
        expect(overflow.oldestAgeMs).toBeGreaterThanOrEqual(0)
        expect(overflow.tokens.every((token) => typeof token === 'string')).toBe(true)
    })

    it('isolates a throwing retry so the rest of the batch still runs', async () => {
        const errors: Array<unknown> = []
        const registry = createPendingRegistry({ onEvent: (event) => {
            errors.push(event)
        } })
        const after = vi.fn()
        registry.add({ token: 'app:bad', host: stubHost({}), retry: () => {
            throw new Error('boom')
        } })
        registry.add({ token: 'app:good', host: stubHost({}), retry: after })
        registry.wakeAll()
        await flushTasks()
        expect(after).toHaveBeenCalledTimes(1)
        expect(errors.length).toBeGreaterThan(0)
    })

    it('satisfies the frozen PendingWake contract (canonical import)', async () => {
        const registry = createPendingRegistry()
        const wake: PendingWake = registry
        const retry = vi.fn()
        const remove = wake.add({ token: 'app:theme', host: stubHost({}), retry })
        registry.wakeAll()
        await flushTasks()
        expect(retry).toHaveBeenCalledTimes(1)
        remove()
        expect(registry.size()).toBe(0)
    })

    it('clear empties the registry without firing onEvict', async () => {
        const registry = createPendingRegistry()
        const onEvict = vi.fn()
        const retry = vi.fn()
        registry.add({ token: 'app:a', host: stubHost({}), retry, onEvict })
        registry.clear()
        expect(registry.size()).toBe(0)
        expect(onEvict).not.toHaveBeenCalled()
        registry.wakeAll()
        await flushTasks()
        expect(retry).not.toHaveBeenCalled()
    })

    it('dedupes synchronous double wake-ups into one retry', async () => {
        const registry = createPendingRegistry()
        const retry = vi.fn()
        registry.add({ token: 'app:theme', host: stubHost({}), retry })
        registry.wakeAll()
        registry.wakeAll()
        await flushTasks()
        expect(retry).toHaveBeenCalledTimes(1)
    })

    it('drops queued retries removed before the flush', async () => {
        const registry = createPendingRegistry()
        const retry = vi.fn()
        const remove = registry.add({ token: 'app:theme', host: stubHost({}), retry })
        registry.wakeAll()
        remove()
        await flushTasks()
        expect(retry).not.toHaveBeenCalled()
        expect(registry.size()).toBe(0)
    })

    it('runs the abort detach exactly once across remove and abort', async () => {
        const registry = createPendingRegistry()
        const retry = vi.fn()
        const controller = new AbortController()
        const remove = registry.add({ token: 'app:theme', host: stubHost({}), retry, signal: controller.signal })
        remove()
        expect(registry.size()).toBe(0)
        controller.abort()
        expect(registry.size()).toBe(0)
        registry.wakeAll()
        await flushTasks()
        expect(retry).not.toHaveBeenCalled()
    })

    it('aborting after remove is a silent no-op', async () => {
        const registry = createPendingRegistry()
        const retry = vi.fn()
        const controller = new AbortController()
        registry.add({ token: 'app:theme', host: stubHost({}), retry, signal: controller.signal })
        controller.abort()
        expect(registry.size()).toBe(0)
        registry.wakeAll()
        await flushTasks()
        expect(retry).not.toHaveBeenCalled()
    })

    it('arms the high-water prune only once per burst', async () => {
        const events: Array<unknown> = []
        const registry = createPendingRegistry({ maxPending: 10, highWaterMark: 2, onEvent: (event) => {
            events.push(event)
        } })
        const retry = vi.fn()
        for (let index = 0; index < 4; index += 1) {
            registry.add({ token: `app:hw-${index}`, host: stubHost({}), retry })
        }
        await flushTasks()
        const highWaters = events.filter((event) => (event as { readonly kind: string }).kind === 'high-water')
        expect(highWaters).toHaveLength(1)
        expect(retry).not.toHaveBeenCalled()
    })

    it('isolates throwing onEvict handlers during overflow', () => {
        const events: Array<unknown> = []
        const registry = createPendingRegistry({ maxPending: 1, onEvent: (event) => {
            events.push(event)
        } })
        registry.add({
            token: 'app:doomed',
            host: stubHost({}),
            retry: () => {},
            onEvict: () => {
                throw new Error('evict-broken')
            },
        })
        expect(() => registry.add({ token: 'app:next', host: stubHost({}), retry: () => {} })).not.toThrow()
        expect(registry.size()).toBe(1)
        expect(events.some((event) => (event as { readonly kind: string }).kind === 'overflow')).toBe(true)
    })

    it('samples private tokens opaquely in the dev ledger', async () => {
        interface LedgerShape {
            readonly kind: string
            readonly tokens: ReadonlyArray<string>
        }
        const events: Array<LedgerShape> = []
        const registry = createPendingRegistry({ maxPending: 10, highWaterMark: 1, onEvent: (event) => {
            events.push(event as LedgerShape)
        } })
        const secret: Token = { name: 'app:secret' }
        registry.add({ token: secret, host: stubHost({}), retry: () => {} })
        registry.add({ token: 'app:second', host: stubHost({}), retry: () => {} })
        await flushTasks()
        const highWater = events.find((event) => event.kind === 'high-water') as LedgerShape | undefined
        expect(highWater).toBeDefined()
        expect(highWater?.tokens).toContain('<private>')
        expect(highWater?.tokens).toContain('app:second')
    })

    it('reports throwing retries through retryAll without stopping', () => {
        const events: Array<unknown> = []
        const registry = createPendingRegistry({ onEvent: (event) => {
            events.push(event)
        } })
        const after = vi.fn()
        registry.add({ token: 'app:bad', host: stubHost({}), retry: () => {
            throw new Error('retry-broken')
        } })
        registry.add({ token: 'app:good', host: stubHost({}), retry: after })
        expect(registry.retryAll()).toBe(2)
        expect(after).toHaveBeenCalledTimes(1)
        expect(events.some((event) => (event as { readonly kind: string }).kind === 'retry-error')).toBe(true)
    })

    it('wakes pending entries when the mounted host exposes no native', async () => {
        const registry = createPendingRegistry()
        const retry = vi.fn()
        const container = document.createElement('div')
        document.body.appendChild(container)
        try {
            registry.add({ token: 'app:theme', host: stubHost(container), retry })
            const nativeLess: HostPort = {
                token: null,
                isConnected: true,
                parent: null,
                lifecycle$: EMPTY,
                on: () => () => {},
                native: (): unknown => {
                    throw new Error('no-native')
                },
            }
            registry.wakeSubtree(nativeLess)
            await flushTasks()
            expect(retry).toHaveBeenCalledTimes(1)
        } finally {
            container.remove()
        }
    })

    it('wakes null-native pending hosts fail-open', async () => {
        const registry = createPendingRegistry()
        const retry = vi.fn()
        const container = document.createElement('div')
        document.body.appendChild(container)
        try {
            registry.add({ token: 'app:theme', host: stubHost(null), retry })
            registry.wakeSubtree(stubHost(container))
            await flushTasks()
            expect(retry).toHaveBeenCalledTimes(1)
        } finally {
            container.remove()
        }
    })

    it('fails open through exotic containment probes', async () => {
        const registry = createPendingRegistry()
        const calls: Array<string> = []
        const nonNumeric = { compareDocumentPosition: () => 'left' }
        const throwingContains = {
            compareDocumentPosition: () => {
                throw new Error('no-compare')
            },
            contains: () => {
                throw new Error('no-contains')
            },
        }
        const bare = {}
        registry.add({ token: 'app:a', host: stubHost(nonNumeric), retry: () => { calls.push('non-numeric') } })
        registry.add({ token: 'app:b', host: stubHost(throwingContains), retry: () => { calls.push('throwing') } })
        registry.add({ token: 'app:c', host: stubHost(bare), retry: () => { calls.push('bare') } })
        registry.wakeSubtree(stubHost({}))
        await flushTasks()
        expect(calls.sort()).toEqual(['bare', 'non-numeric', 'throwing'])
    })

    it('contains check prefers the contains() fallback for non-numeric positions', async () => {
        const registry = createPendingRegistry()
        const retry = vi.fn()
        const ancestor = {
            compareDocumentPosition: () => 'unordered',
            contains: () => true,
        }
        registry.add({ token: 'app:theme', host: stubHost({ node: 1 }), retry })
        registry.wakeSubtree(stubHost(ancestor))
        await flushTasks()
        expect(retry).toHaveBeenCalledTimes(1)
    })
})
