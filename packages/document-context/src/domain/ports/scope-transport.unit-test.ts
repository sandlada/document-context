import { describe, expect, it } from 'vitest'
import { EMPTY, Observable } from 'rxjs'
import type { HostPort } from './host.js'
import type { MaybePromise } from './storage.js'
import type { PrivateToken, Token } from '../model/token.js'
import { isThenable } from './scope-transport.js'
import type { ScopeResolution, ScopeTransportPort } from './scope-transport.js'

interface Registration {
    readonly token: Token
    readonly at: HostPort
    readonly value: unknown
    readonly order: number
}

interface PendingEntry {
    readonly token: Token
    readonly retry: () => boolean
}

/**
 * In-memory scope-transport world: a controllable provider registry over
 * `HostPort` parent chains, plus the transport under contract test. string
 * tokens match by value; private tokens match by reference. No DOM access,
 * no timers: every wake-up is a synchronous `provide()` call.
 */
export interface FakeScopeWorld {
    /** Transport under contract test. */
    readonly transport: ScopeTransportPort
    /**
     * Creates a detached host node whose scope chain starts at `parent`.
     *
     * @param parent Parent scope host, or null for a scope root.
     * @returns A minimal host carrying only the parent link.
     */
    createHost(parent?: HostPort | null): HostPort
    /**
     * Registers a provider value at a host and synchronously wakes matching
     * pending watches.
     *
     * @param token Token to provide (string or private).
     * @param value Provided value; async promises pass through untouched.
     * @param at Host holding the registration.
     * @returns Revoke function removing exactly this registration.
     */
    provide<T>(token: Token, value: MaybePromise<T>, at: HostPort): () => void
    /** Counts currently pending (unsettled, unaborted) watches. */
    pendingCount(): number
}

/**
 * Creates an in-memory scope-transport world with no DOM and no timers.
 *
 * @returns A controllable world exposing the transport under test.
 * @example
 * ```ts
 * import { createFakeScopeTransport } from './scope-transport.unit-test.js'
 *
 * const world = createFakeScopeTransport()
 * const leaf = world.createHost()
 * world.provide('app:theme', 'dark', leaf)
 * ```
 */
export function createFakeScopeTransport(): FakeScopeWorld {
    const registrations = new Map<Token, Array<Registration>>()
    const pendings: Array<PendingEntry> = []
    let order = 0

    const removePending = (entry: PendingEntry): void => {
        const index = pendings.indexOf(entry)
        if (index >= 0) {
            pendings.splice(index, 1)
        }
    }

    const registrationsAt = (token: Token, host: HostPort): Array<Registration> => {
        return (registrations.get(token) ?? []).filter((registration) => registration.at === host)
    }

    const takeNearest = (token: Token, from: HostPort): Registration | null => {
        let current: HostPort | null = from
        while (current !== null) {
            const hit = registrationsAt(token, current)[0]
            if (hit !== undefined) {
                return hit
            }
            current = current.parent
        }
        return null
    }

    const takeAll = (
        token: Token,
        from: HostPort,
        direction: 'bottomUp' | 'topDown',
    ): Array<Registration> => {
        const hits: Array<{ depth: number, order: number, registration: Registration }> = []
        let current: HostPort | null = from
        let depth = 0
        while (current !== null) {
            for (const registration of registrationsAt(token, current)) {
                hits.push({ depth, order: registration.order, registration })
            }
            current = current.parent
            depth += 1
        }
        hits.sort((a, b) => direction === 'bottomUp'
            ? a.depth - b.depth || a.order - b.order
            : b.depth - a.depth || a.order - b.order)
        return hits.map((hit) => hit.registration)
    }

    const snapshot = <T>(registration: Registration): ScopeResolution<T> => ({
        value: registration.value as T,
        unsubscribe: () => {},
    })

    const watchWith = <T>(
        token: Token,
        from: HostPort,
        signal: AbortSignal | undefined,
        settle: (subscriber: { next(value: T): void, complete(): void }) => boolean,
    ): Observable<T> => new Observable<T>((subscriber) => {
        if (signal?.aborted === true) {
            subscriber.complete()
            return undefined
        }
        const entry: PendingEntry = {
            token,
            retry: () => settle(subscriber),
        }
        if (entry.retry()) {
            return undefined
        }
        pendings.push(entry)
        const onAbort = (): void => {
            removePending(entry)
            subscriber.complete()
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        return () => {
            removePending(entry)
            signal?.removeEventListener('abort', onAbort)
        }
    })

    const transport: ScopeTransportPort = {
        request(token, from) {
            const hit = takeNearest(token, from)
            if (hit === null) {
                return null
            }
            return snapshot(hit)
        },
        requestAll(token, from, options) {
            return takeAll(token, from, options?.direction ?? 'bottomUp').map((registration) => snapshot(registration))
        },
        watch(token, from, options) {
            return watchWith(token, from, options?.signal, (subscriber) => {
                const hit = takeNearest(token, from)
                if (hit === null) {
                    return false
                }
                subscriber.next(snapshot(hit))
                subscriber.complete()
                return true
            })
        },
        watchAll(token, from, options) {
            const direction = options?.direction ?? 'bottomUp'
            return watchWith(token, from, options?.signal, (subscriber) => {
                const hits = takeAll(token, from, direction)
                if (hits.length === 0) {
                    return false
                }
                subscriber.next(hits.map((registration) => snapshot(registration)))
                subscriber.complete()
                return true
            })
        },
    }

    return {
        transport,
        createHost(parent: HostPort | null = null) {
            return {
                token: null,
                isConnected: true,
                parent,
                lifecycle$: EMPTY,
                on: () => () => {},
                native: () => ({}),
            }
        },
        provide(token, value, at) {
            const registration: Registration = { token, at, value, order }
            order += 1
            const list = registrations.get(token)
            if (list === undefined) {
                registrations.set(token, [registration])
            } else {
                list.push(registration)
            }
            for (let index = pendings.length - 1; index >= 0; index -= 1) {
                const entry = pendings[index]
                if (entry !== undefined && entry.token === token && entry.retry()) {
                    pendings.splice(index, 1)
                }
            }
            return () => {
                const current = registrations.get(token)
                if (current === undefined) {
                    return
                }
                const index = current.indexOf(registration)
                if (index >= 0) {
                    current.splice(index, 1)
                }
            }
        },
        pendingCount() {
            return pendings.length
        },
    }
}

function collect<T>(observable: Observable<T>): {
    readonly values: Array<T>,
    readonly errors: Array<unknown>,
    readonly completed: () => boolean,
    readonly unsubscribe: () => void,
} {
    const values: Array<T> = []
    const errors: Array<unknown> = []
    let done = false
    const subscription = observable.subscribe({
        next: (value) => {
            values.push(value)
        },
        error: (error: unknown) => {
            errors.push(error)
        },
        complete: () => {
            done = true
        },
    })
    return {
        values,
        errors,
        completed: () => done,
        unsubscribe: () => {
            subscription.unsubscribe()
        },
    }
}

/**
 * Reusable `ScopeTransportPort` contract suite. Every transport (fake, W3C
 * Context Protocol adapter) runs the same assertions by supplying a factory
 * for a controllable world.
 *
 * @param create Factory returning a fresh controllable world per test.
 * @example
 * ```ts
 * import { describe } from 'vitest'
 * import { createFakeScopeTransport, scopeTransportPortContract } from './scope-transport.unit-test.js'
 *
 * describe('fake scope transport', () => {
 *     scopeTransportPortContract(createFakeScopeTransport)
 * })
 * ```
 */
export function scopeTransportPortContract(create: () => FakeScopeWorld): void {
    it('returns a sync snapshot on hit and null on miss', () => {
        const world = create()
        const leaf = world.createHost()
        expect(world.transport.request('app:missing', leaf)).toBeNull()
        world.provide('app:color', 'red', leaf)
        const hit = world.transport.request<string>('app:color', leaf)
        expect(hit?.value).toBe('red')
        expect(typeof hit?.unsubscribe).toBe('function')
        hit?.unsubscribe()
        const tolerated = world.transport.request<string>('app:color', leaf, { subscribe: true })
        expect(tolerated?.value).toBe('red')
        tolerated?.unsubscribe()
    })

    it('resolves single values nearest-first along the parent chain', () => {
        const world = create()
        const root = world.createHost()
        const middle = world.createHost(root)
        const leaf = world.createHost(middle)
        world.provide('app:theme', 'root-theme', root)
        world.provide('app:theme', 'leaf-theme', leaf)
        expect(world.transport.request<string>('app:theme', leaf)?.value).toBe('leaf-theme')
        expect(world.transport.request<string>('app:theme', middle)?.value).toBe('root-theme')
    })

    it('distinguishes private tokens by reference, not by name', () => {
        const world = create()
        const leaf = world.createHost()
        const first: PrivateToken<string> = { name: 'app:secret' }
        const second: PrivateToken<string> = { name: 'app:secret' }
        world.provide(second, 'second-value', leaf)
        expect(world.transport.request<string>(first, leaf)).toBeNull()
        expect(world.transport.request<string>(second, leaf)?.value).toBe('second-value')
    })

    it('orders multi snapshots bottomUp by default with registration-order tiebreak', () => {
        const world = create()
        const root = world.createHost()
        const leaf = world.createHost(root)
        world.provide('app:tag', 'root-tag', root)
        world.provide('app:tag', 'leaf-first', leaf)
        world.provide('app:tag', 'leaf-second', leaf)
        const bottomUp = world.transport.requestAll<string>('app:tag', leaf)
        expect(bottomUp.map((resolution) => resolution.value)).toEqual(['leaf-first', 'leaf-second', 'root-tag'])
        const explicit = world.transport.requestAll<string>('app:tag', leaf, { direction: 'bottomUp' })
        expect(explicit.map((resolution) => resolution.value)).toEqual(['leaf-first', 'leaf-second', 'root-tag'])
    })

    it('orders multi snapshots topDown from the outermost scope inward', () => {
        const world = create()
        const root = world.createHost()
        const middle = world.createHost(root)
        const leaf = world.createHost(middle)
        world.provide('app:tag', 'leaf-tag', leaf)
        world.provide('app:tag', 'root-tag', root)
        world.provide('app:tag', 'middle-tag', middle)
        const topDown = world.transport.requestAll<string>('app:tag', leaf, { direction: 'topDown' })
        expect(topDown.map((resolution) => resolution.value)).toEqual(['root-tag', 'middle-tag', 'leaf-tag'])
    })

    it('treats an empty requestAll snapshot as legal', () => {
        const world = create()
        const leaf = world.createHost()
        expect(world.transport.requestAll('app:missing', leaf)).toEqual([])
    })

    it('keeps watch cold: nothing resolves before subscribe', () => {
        const world = create()
        const leaf = world.createHost()
        const pending = world.transport.watch<string>('app:late', leaf)
        expect(world.pendingCount()).toBe(0)
        world.provide('app:late', 'late-value', leaf)
        expect(world.pendingCount()).toBe(0)
        const collected = collect(pending)
        expect(collected.values.map((resolution) => resolution.value)).toEqual(['late-value'])
        expect(collected.completed()).toBe(true)
        expect(collected.errors).toEqual([])
    })

    it('wakes a pending watch on provide and settles it exactly once', () => {
        const world = create()
        const leaf = world.createHost()
        const collected = collect(world.transport.watch<string>('app:late', leaf))
        expect(world.pendingCount()).toBe(1)
        expect(collected.values).toEqual([])
        world.provide('app:late', 'woken', leaf)
        expect(collected.values.map((resolution) => resolution.value)).toEqual(['woken'])
        expect(collected.completed()).toBe(true)
        expect(world.pendingCount()).toBe(0)
        world.provide('app:late', 'second', leaf)
        expect(collected.values).toHaveLength(1)
    })

    it('settles watchAll on the first non-empty snapshot and never on empty', () => {
        const world = create()
        const leaf = world.createHost()
        const collected = collect(world.transport.watchAll<string>('app:tags', leaf))
        world.provide('app:other', 'unrelated', leaf)
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(false)
        expect(world.pendingCount()).toBe(1)
        world.provide('app:tags', 'first', leaf)
        expect(collected.completed()).toBe(true)
        expect(world.pendingCount()).toBe(0)
        expect(collected.values).toHaveLength(1)
        const [only] = collected.values
        expect(only?.map((resolution) => resolution.value)).toEqual(['first'])
    })

    it('honours the watchAll direction option', () => {
        const world = create()
        const root = world.createHost()
        const leaf = world.createHost(root)
        world.provide('app:tag', 'leaf-tag', leaf)
        world.provide('app:tag', 'root-tag', root)
        const collected = collect(world.transport.watchAll<string>('app:tag', leaf, { direction: 'topDown' }))
        expect(collected.completed()).toBe(true)
        const [only] = collected.values
        expect(only?.map((resolution) => resolution.value)).toEqual(['root-tag', 'leaf-tag'])
    })

    it('completes a pending watch on abort and drops its entry', () => {
        const world = create()
        const leaf = world.createHost()
        const controller = new AbortController()
        const collected = collect(world.transport.watch<string>('app:abort', leaf, { signal: controller.signal }))
        expect(world.pendingCount()).toBe(1)
        controller.abort()
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(true)
        expect(world.pendingCount()).toBe(0)
        world.provide('app:abort', 'too-late', leaf)
        expect(collected.values).toEqual([])
    })

    it('completes immediately when the signal is already aborted', () => {
        const world = create()
        const leaf = world.createHost()
        const collected = collect(
            world.transport.watch<string>('app:abort', leaf, { signal: AbortSignal.abort() }),
        )
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(true)
        expect(world.pendingCount()).toBe(0)
    })

    it('drops the pending entry when a watch unsubscribes before settling', () => {
        const world = create()
        const leaf = world.createHost()
        const collected = collect(world.transport.watch<string>('app:gone', leaf))
        expect(world.pendingCount()).toBe(1)
        collected.unsubscribe()
        expect(world.pendingCount()).toBe(0)
        world.provide('app:gone', 'too-late', leaf)
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(false)
    })
}

describe('FakeScopeTransport (in-memory scope transport)', () => {
    scopeTransportPortContract(createFakeScopeTransport)
})

describe('isThenable', () => {
    it('detects native promises without instanceof', () => {
        expect(isThenable(Promise.resolve(1))).toBe(true)
        expect(isThenable(new Promise<void>((resolve) => {
            resolve()
        }))).toBe(true)
    })

    it('detects duck-typed thenables by a function then property', () => {
        expect(isThenable({ then: (resolve: (value: number) => void) => resolve(1) })).toBe(true)
    })

    it('accepts functions carrying a then method', () => {
        const fn = (() => {}) as (() => void) & { then?: unknown }
        fn.then = (resolve: (value: number) => void) => resolve(1)
        expect(isThenable(fn)).toBe(true)
    })

    it('rejects null, primitives, and non-function then values', () => {
        const nonThenables: ReadonlyArray<unknown> = [
            null,
            undefined,
            0,
            'then',
            true,
            {},
            { then: 42 },
            { then: null },
            [],
        ]
        for (const value of nonThenables) {
            expect(isThenable(value)).toBe(false)
        }
    })
})
