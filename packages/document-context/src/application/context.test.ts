import { describe, expect, it, vi } from 'vitest'
import { Subject } from 'rxjs'
import type { Session } from '../domain/index.js'
import type { ApplicationPorts } from './context.js'
import { createApplicationContext, createHostSessionMap, createKeyedSessionMap } from './context.js'
import { createFakeScheduler, createFakeScopeTransport, createFakeStorage } from '../domain/testing/fakes.js'

const stubPorts = (): ApplicationPorts => {
    const scheduler = createFakeScheduler()
    const world = createFakeScopeTransport()
    const storage = createFakeStorage()
    return {
        host: {
            toHost: (node: unknown) => world.createHost(),
            scheduler,
            scopeTransport: world.transport,
            tokens: {
                read: () => null,
                write: () => {},
            },
        },
        storage: {
            resolve: () => storage.port,
        },
    }
}

const stubSession = (id: string): Session => ({ id }) as unknown as Session

describe('createApplicationContext', () => {
    it('assembles every field with empty initial state', () => {
        const ports = stubPorts()
        const ctx = createApplicationContext(ports)
        expect(ctx.ports).toBe(ports)
        expect(ctx.sessions.get({})).toBeUndefined()
        expect(ctx.keyed.get('app:missing')).toBeUndefined()
        expect(ctx.records.get({})).toBeUndefined()
        expect(ctx.singletons.size).toBe(0)
        expect(ctx.settled$).toBeInstanceOf(Subject)
    })

    it('hands each call an independent context', () => {
        const ports = stubPorts()
        const first = createApplicationContext(ports)
        const second = createApplicationContext(ports)
        expect(first.sessions).not.toBe(second.sessions)
        expect(first.keyed).not.toBe(second.keyed)
        expect(first.records).not.toBe(second.records)
        expect(first.singletons).not.toBe(second.singletons)
        expect(first.settled$).not.toBe(second.settled$)
    })

    it('shares the ports reference without copying', () => {
        const ports = stubPorts()
        const ctx = createApplicationContext(ports)
        expect(ctx.ports.host.scheduler).toBe(ports.host.scheduler)
        expect(ctx.ports.host.scopeTransport).toBe(ports.host.scopeTransport)
    })
})

describe('HostSessionMap', () => {
    it('round-trips entries keyed by native host object', () => {
        const map = createHostSessionMap()
        const native = {}
        const entry = { facade: stubSession('a'), record: {} as never }
        expect(map.get(native)).toBeUndefined()
        map.set(native, entry)
        expect(map.get(native)).toBe(entry)
    })

    it('keeps distinct native objects independent', () => {
        const map = createHostSessionMap()
        const first = {}
        const second = {}
        const entry = { facade: stubSession('a'), record: {} as never }
        map.set(first, entry)
        expect(map.get(second)).toBeUndefined()
    })

    it('overwrites on repeat set and forgets on delete', () => {
        const map = createHostSessionMap()
        const native = {}
        const first = { facade: stubSession('a'), record: {} as never }
        const second = { facade: stubSession('b'), record: {} as never }
        map.set(native, first)
        map.set(native, second)
        expect(map.get(native)).toBe(second)
        map.delete(native)
        expect(map.get(native)).toBeUndefined()
    })

    it('does not hold entries by token string (native identity only)', () => {
        const map = createHostSessionMap()
        expect(map.get({})).toBeUndefined()
    })
})

describe('KeyedSessionMap', () => {
    it('round-trips live facades by token', () => {
        const map = createKeyedSessionMap()
        const facade = stubSession('live')
        expect(map.get('app:box')).toBeUndefined()
        map.set('app:box', facade)
        expect(map.get('app:box')).toBe(facade)
    })

    it('overwrites on repeat set and forgets on delete', () => {
        const map = createKeyedSessionMap()
        const first = stubSession('first')
        const second = stubSession('second')
        map.set('app:box', first)
        map.set('app:box', second)
        expect(map.get('app:box')).toBe(second)
        map.delete('app:box')
        expect(map.get('app:box')).toBeUndefined()
    })

    it('prunes collected facades on access', () => {
        const created: Array<{ collect(): void }> = []
        class ControllableRef {
            private target: object | undefined
            constructor(target: object) {
                this.target = target
                created.push(this)
            }
            deref(): object | undefined {
                return this.target
            }
            collect(): void {
                this.target = undefined
            }
        }
        const realWeakRef = globalThis.WeakRef
        vi.stubGlobal('WeakRef', ControllableRef)
        try {
            const map = createKeyedSessionMap()
            const first = stubSession('first')
            const second = stubSession('second')
            map.set('app:first', first)
            map.set('app:second', second)
            expect(created.length).toBe(2)
            created[0]?.collect()
            expect(map.get('app:first')).toBeUndefined()
            expect(map.get('app:second')).toBe(second)
            expect(map.get('app:first')).toBeUndefined()
        } finally {
            vi.unstubAllGlobals()
            expect(globalThis.WeakRef).toBe(realWeakRef)
        }
    })

    it('prunes dead entries encountered during set', () => {
        const created: Array<{ collect(): void }> = []
        class ControllableRef {
            private target: object | undefined
            constructor(target: object) {
                this.target = target
                created.push(this)
            }
            deref(): object | undefined {
                return this.target
            }
            collect(): void {
                this.target = undefined
            }
        }
        vi.stubGlobal('WeakRef', ControllableRef)
        try {
            const map = createKeyedSessionMap()
            map.set('app:gone', stubSession('gone'))
            created[0]?.collect()
            map.set('app:fresh', stubSession('fresh'))
            expect(map.get('app:gone')).toBeUndefined()
            expect(map.get('app:fresh')).toBeDefined()
        } finally {
            vi.unstubAllGlobals()
        }
    })
})

describe('ApplicationContext singletons', () => {
    it('holds inflight entries until they resolve', () => {
        const ctx = createApplicationContext(stubPorts())
        const promise = Promise.resolve({ id: 'svc' })
        ctx.singletons.set('app:svc', { status: 'inflight', promise })
        expect(ctx.singletons.get('app:svc')).toEqual({ status: 'inflight', promise })
        ctx.singletons.set('app:svc', { status: 'resolved', value: { id: 'svc' } })
        expect(ctx.singletons.get('app:svc')).toEqual({ status: 'resolved', value: { id: 'svc' } })
    })

    it('evicts entries on rejection for self-healing retries', () => {
        const ctx = createApplicationContext(stubPorts())
        const promise = Promise.reject(new Error('boom'))
        promise.catch(() => {})
        ctx.singletons.set('app:flaky', { status: 'inflight', promise })
        ctx.singletons.delete('app:flaky')
        expect(ctx.singletons.get('app:flaky')).toBeUndefined()
    })
})

describe('ApplicationContext settled$', () => {
    it('broadcasts rescan triggers to every subscriber', () => {
        const ctx = createApplicationContext(stubPorts())
        const seen: Array<string> = []
        ctx.settled$.subscribe(() => {
            seen.push('first')
        })
        ctx.settled$.subscribe(() => {
            seen.push('second')
        })
        ctx.settled$.next()
        expect(seen).toEqual(['first', 'second'])
    })

    it('supports late subscribers receiving later triggers', () => {
        const ctx = createApplicationContext(stubPorts())
        ctx.settled$.next()
        let count = 0
        ctx.settled$.subscribe(() => {
            count += 1
        })
        ctx.settled$.next()
        expect(count).toBe(1)
    })
})
