import { describe, expect, it } from 'vitest'
import { DocumentContextError } from '../model/errors.js'
import { createServiceRegistry } from '../model/service.js'
import type { ServiceRegistration } from '../model/service.js'
import { createFakeScopeTransport } from '../testing/fakes.js'
import { resolveAllSync, resolveSync, resolveViaTransport } from './resolve.js'
import type { SyncServiceStore } from './resolve.js'

const single = (token: string, value: unknown, extra: Partial<ServiceRegistration> = {}): ServiceRegistration => ({
    token,
    factory: () => value,
    lifecycle: 'scoped',
    async: false,
    multi: false,
    eager: false,
    ...extra,
})

const storeFor = (regs: ReadonlyArray<ServiceRegistration>, isDisposed = false): SyncServiceStore => {
    const singles = new Map<string, ServiceRegistration>()
    const multis = new Map<string, Array<ServiceRegistration>>()
    const registry = createServiceRegistry()
    for (const reg of regs) {
        if (reg.multi) {
            const list = multis.get(reg.token as string)
            if (list === undefined) {
                multis.set(reg.token as string, [reg])
            } else {
                list.push(reg)
            }
        } else {
            singles.set(reg.token as string, reg)
        }
        registry.register(reg)
    }
    return { singles, multis, registry, isDisposed }
}

describe('resolveSync single-fetch', () => {
    it('returns the factory value for a registered single', () => {
        const services = storeFor([single('app:user', { id: 'u1' })])
        expect(resolveSync({ services, token: 'app:user', session: {} })).toEqual({ id: 'u1' })
    })

    it('throws DISPOSED_SESSION when the session is disposed, before lookup', () => {
        const services = storeFor([single('app:user', 1)], true)
        try {
            resolveSync({ services, token: 'app:user', session: {} })
            throw new Error('expected DISPOSED_SESSION')
        } catch (error) {
            expect(error).toBeInstanceOf(DocumentContextError)
            expect((error as DocumentContextError).code).toBe('DISPOSED_SESSION')
        }
    })

    it('throws UNKNOWN_SERVICE for a missing token', () => {
        const services = storeFor([])
        try {
            resolveSync({ services, token: 'app:missing', session: {} })
            throw new Error('expected UNKNOWN_SERVICE')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('UNKNOWN_SERVICE')
            expect((error as DocumentContextError).details).toEqual({ token: 'app:missing' })
        }
    })

    it('lets single win when single and multi coexist under one token', () => {
        const services = storeFor([
            single('app:mixed', 'single-value'),
            { ...single('app:mixed', 'multi-value'), multi: true },
        ])
        expect(resolveSync({ services, token: 'app:mixed', session: {} })).toBe('single-value')
    })

    it('throws UNKNOWN_SERVICE for multi-only tokens on single-fetch', () => {
        const services = storeFor([{ ...single('app:mw', 1), multi: true }])
        try {
            resolveSync({ services, token: 'app:mw', session: {} })
            throw new Error('expected UNKNOWN_SERVICE')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('UNKNOWN_SERVICE')
        }
    })

    it('throws ASYNC_SERVICE_NOT_READY when a sync path touches a promise value', () => {
        const services = storeFor([single('app:async', Promise.resolve('late'))])
        try {
            resolveSync({ services, token: 'app:async', session: {} })
            throw new Error('expected ASYNC_SERVICE_NOT_READY')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('ASYNC_SERVICE_NOT_READY')
        }
    })

    it('throws ASYNC_SERVICE_NOT_READY for async-flagged registrations', () => {
        const services = storeFor([single('app:lazy-async', 'value', { async: true, factory: () => Promise.resolve('v') as unknown as string })])
        try {
            resolveSync({ services, token: 'app:lazy-async', session: {} })
            throw new Error('expected ASYNC_SERVICE_NOT_READY')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('ASYNC_SERVICE_NOT_READY')
        }
    })

    it('throws CIRCULAR_DEPENDENCY on sync re-entry of the same token', () => {
        const registry = createServiceRegistry()
        const reg = single('app:loop', 'value')
        const services: SyncServiceStore = {
            singles: new Map([['app:loop', reg]]),
            multis: new Map(),
            registry,
            isDisposed: false,
        }
        const session = {}
        try {
            registry.resolveSync('app:loop', () => resolveSync({ services, token: 'app:loop', session }))
            throw new Error('expected CIRCULAR_DEPENDENCY')
        } catch (error) {
            expect(error).toBeInstanceOf(DocumentContextError)
            expect((error as DocumentContextError).code).toBe('CIRCULAR_DEPENDENCY')
        }
    })

    it('passes the session through to the factory', () => {
        const session = { id: 's1' }
        let seen: unknown = null
        const services = storeFor([{
            ...single('app:echo', null),
            factory: (s: unknown) => {
                seen = s
                return 'echoed'
            },
        }])
        expect(resolveSync({ services, token: 'app:echo', session })).toBe('echoed')
        expect(seen).toBe(session)
    })
})

describe('resolveAllSync multi-fetch', () => {
    it('collects multi registrations in order and returns an empty snapshot when absent', () => {
        const services = storeFor([
            { ...single('app:tag', 'a'), multi: true },
            { ...single('app:tag', 'b'), multi: true },
        ])
        expect(resolveAllSync({ services, token: 'app:tag', session: {} })).toEqual(['a', 'b'])
        expect(resolveAllSync({ services, token: 'app:missing', session: {} })).toEqual([])
    })

    it('throws DISPOSED_SESSION when disposed', () => {
        const services = storeFor([{ ...single('app:tag', 'a'), multi: true }], true)
        expect(() => resolveAllSync({ services, token: 'app:tag', session: {} })).toThrowError(DocumentContextError)
        try {
            resolveAllSync({ services, token: 'app:tag', session: {} })
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('DISPOSED_SESSION')
        }
    })

    it('throws ASYNC_SERVICE_NOT_READY when any multi entry is unready (no partial skip)', () => {
        const services = storeFor([
            { ...single('app:tag', 'ready'), multi: true },
            { ...single('app:tag', Promise.resolve('late')), multi: true },
        ])
        try {
            resolveAllSync({ services, token: 'app:tag', session: {} })
            throw new Error('expected ASYNC_SERVICE_NOT_READY')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('ASYNC_SERVICE_NOT_READY')
        }
    })
})

describe('resolveViaTransport', () => {
    it('passes through the nearest hit and returns null on miss', () => {
        const world = createFakeScopeTransport()
        const root = world.createHost()
        const leaf = world.createHost(root)
        expect(resolveViaTransport(world.transport, 'app:missing', leaf)).toBeNull()
        world.provide('app:theme', 'leaf-theme', leaf)
        world.provide('app:theme', 'root-theme', root)
        expect(resolveViaTransport(world.transport, 'app:theme', leaf)?.value).toBe('leaf-theme')
    })
})
