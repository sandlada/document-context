import { describe, expect, it } from 'vitest'
import type { Session } from '../../domain/index.js'
import type { ApplicationContext } from '../context.js'
import { createApplicationContext } from '../context.js'
import { createFakeHost, createFakeScheduler, createFakeScopeTransport, createFakeStorage } from '../../domain/testing/fakes.js'
import { createAttach } from './attach.js'

const stubContext = (): ApplicationContext => {
    const scheduler = createFakeScheduler()
    const world = createFakeScopeTransport()
    const storage = createFakeStorage()
    return createApplicationContext({
        host: {
            toHost: () => world.createHost(),
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
    })
}

const stubSession = (connected: boolean): Session => ({ host: createFakeHost({ connected }) }) as unknown as Session

describe('createAttach', () => {
    it('fires onConnect on first connect and pushes a rescan trigger', () => {
        const ctx = stubContext()
        const events: Array<string> = []
        ctx.settled$.subscribe(() => {
            events.push('settled')
        })
        const calls: Array<string> = []
        const hooks = createAttach(ctx)({ onConnect: () => calls.push('connect') })(stubSession(false))
        hooks.connect()
        expect(calls).toEqual(['connect'])
        expect(events).toEqual(['settled'])
    })

    it('treats repeat connect as a no-op (dual-channel idempotency)', () => {
        const ctx = stubContext()
        let settled = 0
        ctx.settled$.subscribe(() => {
            settled += 1
        })
        let calls = 0
        const hooks = createAttach(ctx)({ onConnect: () => calls += 1 })(stubSession(false))
        hooks.connect()
        hooks.connect()
        hooks.connect()
        expect(calls).toBe(1)
        expect(settled).toBe(1)
    })

    it('starts connected when the host is already connected', () => {
        const ctx = stubContext()
        let settled = 0
        ctx.settled$.subscribe(() => {
            settled += 1
        })
        let calls = 0
        const hooks = createAttach(ctx)({ onConnect: () => calls += 1 })(stubSession(true))
        hooks.connect()
        expect(calls).toBe(0)
        expect(settled).toBe(0)
    })

    it('fires onDisconnect on first disconnect and pushes a rescan trigger', () => {
        const ctx = stubContext()
        const events: Array<string> = []
        ctx.settled$.subscribe(() => {
            events.push('settled')
        })
        const calls: Array<string> = []
        const hooks = createAttach(ctx)({ onDisconnect: () => calls.push('disconnect') })(stubSession(true))
        hooks.disconnect()
        expect(calls).toEqual(['disconnect'])
        expect(events).toEqual(['settled'])
    })

    it('treats repeat disconnect as a no-op', () => {
        const ctx = stubContext()
        let settled = 0
        ctx.settled$.subscribe(() => {
            settled += 1
        })
        let calls = 0
        const hooks = createAttach(ctx)({ onDisconnect: () => calls += 1 })(stubSession(true))
        hooks.disconnect()
        hooks.disconnect()
        expect(calls).toBe(1)
        expect(settled).toBe(1)
    })

    it('alternates connect and disconnect with a trigger per flip', () => {
        const ctx = stubContext()
        let settled = 0
        ctx.settled$.subscribe(() => {
            settled += 1
        })
        const hooks = createAttach(ctx)({})(stubSession(true))
        hooks.disconnect()
        hooks.connect()
        hooks.disconnect()
        expect(settled).toBe(3)
    })

    it('works without any config callbacks', () => {
        const ctx = stubContext()
        let settled = 0
        ctx.settled$.subscribe(() => {
            settled += 1
        })
        const hooks = createAttach(ctx)()(stubSession(false))
        hooks.connect()
        hooks.disconnect()
        hooks.adopt('doc-b')
        expect(settled).toBe(2)
    })

    it('records adoption and fires onAdopt without touching settled$', () => {
        const ctx = stubContext()
        let settled = 0
        ctx.settled$.subscribe(() => {
            settled += 1
        })
        const owners: Array<unknown> = []
        const hooks = createAttach(ctx)({ onAdopt: (owner) => owners.push(owner) })(stubSession(true))
        hooks.adopt('doc-b')
        expect(owners).toEqual(['doc-b'])
        expect(settled).toBe(0)
    })

    it('treats repeat adoption by the same owner as a no-op', () => {
        const ctx = stubContext()
        let calls = 0
        const hooks = createAttach(ctx)({ onAdopt: () => calls += 1 })(stubSession(true))
        hooks.adopt('doc-b')
        hooks.adopt('doc-b')
        expect(calls).toBe(1)
    })

    it('fires onAdopt again when the owner changes', () => {
        const ctx = stubContext()
        const owners: Array<unknown> = []
        const hooks = createAttach(ctx)({ onAdopt: (owner) => owners.push(owner) })(stubSession(true))
        hooks.adopt('doc-b')
        hooks.adopt('doc-c')
        expect(owners).toEqual(['doc-b', 'doc-c'])
    })

    it('keeps per-session flags independent', () => {
        const ctx = stubContext()
        let firstCalls = 0
        let secondCalls = 0
        const attach = createAttach(ctx)
        const first = attach({ onConnect: () => firstCalls += 1 })(stubSession(false))
        const second = attach({ onConnect: () => secondCalls += 1 })(stubSession(false))
        first.connect()
        expect(firstCalls).toBe(1)
        expect(secondCalls).toBe(0)
        second.connect()
        expect(secondCalls).toBe(1)
    })

    it('shares one flag across repeated attach calls for the same session', () => {
        const ctx = stubContext()
        let calls = 0
        const session = stubSession(false)
        const attach = createAttach(ctx)
        attach({ onConnect: () => calls += 1 })(session).connect()
        attach({ onConnect: () => calls += 1 })(session).connect()
        expect(calls).toBe(1)
    })
})
