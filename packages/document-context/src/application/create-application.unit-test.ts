import { describe, expect, it } from 'vitest'
import type { Session } from '../domain/index.js'
import { createFakeHost, createFakeScopeTransport, createFakeStorage } from '../domain/testing/fakes.js'
import type { ApplicationPorts } from './context.js'
import { createApplication } from './create-application.js'
import { createContext } from './api/create-context.js'
import { pipe } from './api/pipe.js'
import { provide, provideSync } from './api/provide.js'
import { onAdopt, onDispose, onMount, onResuscitate, onSuspend } from './api/hooks.js'
import { persist } from './api/persist.js'

const stubPorts = (): ApplicationPorts => {
    const world = createFakeScopeTransport()
    const storage = createFakeStorage()
    return {
        host: {
            toHost: () => world.createHost(),
            scheduler: {
                microtask: (task) => queueMicrotask(task),
                timeout: (task, ms) => {
                    const id = setTimeout(task, ms)
                    return () => clearTimeout(id)
                },
                frame: (task) => {
                    queueMicrotask(task)
                    return () => {}
                },
            },
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

describe('createApplication surface', () => {
    it('exposes every first- and second-class verb', () => {
        const app = createApplication(stubPorts())
        const keys: ReadonlyArray<keyof typeof app> = [
            'createContext', 'pipe', 'provide', 'provideSync',
            'onMount', 'onDispose', 'onSuspend', 'onResuscitate', 'onAdopt',
            'persist', 'attach',
            'mount', 'mountSync', 'getSessionSync', 'session$',
            'selectSync', 'select$', 'update', 'subscribe$',
            'inject', 'injectSync', 'inject$', 'injectAll', 'injectAllSync', 'injectAll$',
            'dispose', 'serialize',
        ]
        expect(Object.keys(app).sort()).toEqual([...keys].sort())
        for (const key of keys) {
            expect(typeof app[key], key).toBe('function')
        }
    })

    it('re-exports pure operators by reference without binding', () => {
        const app = createApplication(stubPorts())
        expect(app.createContext).toBe(createContext)
        expect(app.pipe).toBe(pipe)
        expect(app.provide).toBe(provide)
        expect(app.provideSync).toBe(provideSync)
        expect(app.onMount).toBe(onMount)
        expect(app.onDispose).toBe(onDispose)
        expect(app.onSuspend).toBe(onSuspend)
        expect(app.onResuscitate).toBe(onResuscitate)
        expect(app.onAdopt).toBe(onAdopt)
        expect(app.persist).toBe(persist)
    })

    it('binds attach and serialize to the application context', () => {
        const app = createApplication(stubPorts())
        const session = { host: createFakeHost({ connected: true }) } as unknown as Session
        const first = app.attach()(session)
        const second = app.attach()(session)
        expect(first).not.toBe(second)
        expect(typeof app.serialize).toBe('function')
        first.connect()
        second.disconnect()
    })
})

describe('createApplication isolation', () => {
    it('keeps per-application attach flags independent', () => {
        const first = createApplication(stubPorts())
        const second = createApplication(stubPorts())
        expect(first.attach).not.toBe(second.attach)
        expect(first.serialize).not.toBe(second.serialize)
        expect(first.mount).not.toBe(second.mount)
    })

    it('does not leak sessions across applications', () => {
        const first = createApplication(stubPorts())
        const second = createApplication(stubPorts())
        const stranger = {} as unknown as Session<{ count: number }>
        expect(() => first.serialize()(stranger)).toThrowError(/no mount record/)
        expect(() => second.serialize()(stranger)).toThrowError(/no mount record/)
    })
})

describe('createApplication mount smoke', () => {
    it('mounts, updates, and serializes through bound verbs', async () => {
        const app = createApplication(stubPorts())
        const blueprint = app.pipe(
            app.createContext({ count: 0 }),
            app.persist({ storage: 'localStorage', key: 'smoke' }),
        )
        const session = await app.mount(blueprint)({} as unknown as HTMLElement)
        expect(session.isDisposed).toBe(false)
        expect(app.update({ count: 1 })(session)).toBe(true)
        expect(app.selectSync((state: { count: number }) => state.count)(session)).toBe(1)
        expect(app.serialize()(session)).toBe('{"count":1}')
        app.dispose(session)
        expect(session.isDisposed).toBe(true)
    })
})
