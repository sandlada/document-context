/**
 * Composition-root tests: the default wired application and its verb
 * surface. Runs in a DOM environment (happy-dom via the infrastructure
 * project include, or an explicit DOM run): mounts need connected elements.
 */
import { describe, expect, it } from 'vitest'
import {
    app,
    attach,
    createApplication,
    createContext,
    dispose,
    getSessionSync,
    inject,
    inject$,
    injectAll,
    injectAll$,
    injectAllSync,
    injectSync,
    mount,
    mountSync,
    onAdopt,
    onDispose,
    onMount,
    onResuscitate,
    onSuspend,
    persist,
    pipe,
    provide,
    provideSync,
    select$,
    selectSync,
    serialize,
    session$,
    subscribe$,
    update,
} from './index.js'
import type { HostPort, SchedulerPort, ScopeTransportPort, Session } from './domain/index.js'
import type { ApplicationPorts } from './application/index.js'
import { createDomAdapter } from './infrastructure/dom/index.js'
import { createStorageAdapters } from './infrastructure/storage/index.js'

const mountElement = (): HTMLElement => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    return element
}

describe('composition surface', () => {
    it('exposes the full verb surface with mount wrappers bound', () => {
        for (const verb of [
            createContext, pipe, provide, provideSync,
            onMount, onDispose, onSuspend, onResuscitate, onAdopt,
            persist, attach,
            mount, mountSync, getSessionSync, session$,
            selectSync, select$, update, subscribe$,
            inject, injectSync, inject$, injectAll, injectAllSync, injectAll$,
            dispose, serialize,
        ]) {
            expect(typeof verb).toBe('function')
        }
        expect(Object.keys(app).sort()).toEqual([
            'createContext', 'pipe', 'provide', 'provideSync',
            'onMount', 'onDispose', 'onSuspend', 'onResuscitate', 'onAdopt',
            'persist', 'attach',
            'mount', 'mountSync', 'getSessionSync', 'session$',
            'selectSync', 'select$', 'update', 'subscribe$',
            'inject', 'injectSync', 'inject$', 'injectAll', 'injectAllSync', 'injectAll$',
            'dispose', 'serialize',
        ].sort())
    })

    it('passes pure verbs through by reference and wraps only the mounts', () => {
        expect(createContext).toBe(app.createContext)
        expect(pipe).toBe(app.pipe)
        expect(provide).toBe(app.provide)
        expect(inject).toBe(app.inject)
        expect(injectSync).toBe(app.injectSync)
        expect(update).toBe(app.update)
        expect(dispose).toBe(app.dispose)
        expect(serialize).toBe(app.serialize)
        expect(mount).not.toBe(app.mount)
        expect(mountSync).not.toBe(app.mountSync)
    })

    it('mounts, updates, selects, serializes, and disposes end to end', async () => {
        const element = mountElement()
        try {
            const blueprint = pipe(createContext({ count: 0 }))
            const session = await mount(blueprint)(element)
            expect(session.isDisposed).toBe(false)
            expect(update({ count: 2 })(session)).toBe(true)
            expect(selectSync((state: { count: number }) => state.count)(session)).toBe(2)
            expect(serialize()(session)).toBe('{"count":2}')
            dispose(session)
            expect(session.isDisposed).toBe(true)
        } finally {
            element.remove()
        }
    })

    it('announces the initial mount and the terminal dispose on the host', async () => {
        const element = mountElement()
        try {
            const seen: Array<{ readonly name: string, readonly token: unknown }> = []
            element.addEventListener('context-mount', (event) => {
                seen.push({ name: 'context-mount', token: (event as CustomEvent).detail.token })
            })
            element.addEventListener('context-dispose', (event) => {
                seen.push({ name: 'context-dispose', token: (event as CustomEvent).detail.token })
            })
            const session = await mount(pipe(createContext({ count: 0 })))(element)
            expect(seen).toEqual([{ name: 'context-mount', token: null }])
            dispose(session)
            expect(seen).toEqual([
                { name: 'context-mount', token: null },
                { name: 'context-dispose', token: null },
            ])
        } finally {
            element.remove()
        }
    })

    it('mountSync announces without waiting', () => {
        const element = mountElement()
        try {
            let mounts = 0
            element.addEventListener('context-mount', () => {
                mounts += 1
            })
            const session = mountSync(pipe(createContext({ count: 0 })))(element)
            expect(mounts).toBe(1)
            dispose(session)
        } finally {
            element.remove()
        }
    })

    it('writes and clears keyed identities through the composed tokens', async () => {
        const element = mountElement()
        try {
            const session = await mount(pipe(createContext({ count: 0 })), { token: 'app:composed-key' })(element)
            expect(session.token).toBe('app:composed-key')
            expect(element.getAttribute('data-context-key')).toBe('app:composed-key')
            dispose(session)
            expect(element.hasAttribute('data-context-key')).toBe(false)
            expect(session.isDisposed).toBe(true)
        } finally {
            element.remove()
        }
    })

    it('resolves the scope transport lazily on inject with a timeout', async () => {
        const element = mountElement()
        try {
            const session = await mount(pipe(createContext({ count: 0 })))(element)
            try {
                await expect(inject('app:missing', { timeoutMs: 10 })(element)).rejects.toMatchObject({
                    code: 'RESOLUTION_TIMEOUT',
                })
            } finally {
                dispose(session)
            }
        } finally {
            element.remove()
        }
    })

    it('degrades a throwing payload resolver to null without failing the mount', async () => {
        const element = mountElement()
        const original = document.getElementById.bind(document)
        document.getElementById = (() => {
            throw new Error('payload-denied')
        }) as typeof document.getElementById
        try {
            const session = await mount(pipe(createContext({ count: 0 })))(element)
            expect(session.isDisposed).toBe(false)
            dispose(session)
        } finally {
            document.getElementById = original
            element.remove()
        }
    })

    it('skips announcements without a CustomEvent global', async () => {
        const element = mountElement()
        const globals = globalThis as unknown as Record<string, unknown>
        const saved = globals['CustomEvent']
        globals['CustomEvent'] = undefined
        try {
            const session = await mount(pipe(createContext({ count: 0 })))(element)
            expect(session.isDisposed).toBe(false)
            dispose(session)
        } finally {
            globals['CustomEvent'] = saved
            element.remove()
        }
    })

    it('announces nothing for sessions parked suspended at mount time', async () => {
        const element = mountElement()
        const seen: Array<string> = []
        element.addEventListener('context-mount', () => {
            seen.push('context-mount')
        })
        try {
            let resolveGate!: (value: string) => void
            const gate = new Promise<string>((resolve) => {
                resolveGate = resolve
            })
            const blueprint = pipe(
                createContext({ count: 0 }),
                provide('app:gate', () => gate, { eager: true }),
            )
            const pending = mount(blueprint, { token: 'app:parked-announce' })(element)
            element.remove()
            document.body.appendChild(element)
            await new Promise<void>((resolve) => {
                setTimeout(() => resolve(), 0)
            })
            element.remove()
            await new Promise<void>((resolve) => {
                setTimeout(() => resolve(), 0)
            })
            resolveGate('open')
            const session = await pending
            expect(session.isSuspended).toBe(true)
            expect(seen).toEqual([])
            dispose(session)
        } finally {
            element.remove()
        }
    })
})

describe('composition injection without transport', () => {
    const throwingPorts = (): ApplicationPorts => {
        const dom = createDomAdapter()
        const throwing: ScopeTransportPort = {
            request: (): never => {
                throw new Error('transport must not be used')
            },
            requestAll: (): never => {
                throw new Error('transport must not be used')
            },
            watch: (): never => {
                throw new Error('transport must not be used')
            },
            watchAll: (): never => {
                throw new Error('transport must not be used')
            },
        }
        const scheduler: SchedulerPort = dom.scheduler
        return {
            host: {
                toHost: (node: unknown): HostPort => dom.toHost(node) as unknown as HostPort,
                scheduler,
                scopeTransport: throwing,
                tokens: {
                    read: (): null => null,
                    write: (): void => {},
                },
            },
            storage: createStorageAdapters(),
        }
    }

    it('resolves a session-local sync service on every face without transport', async () => {
        const local = throwingPorts()
        const scoped = createApplication(local)
        const element = mountElement()
        try {
            const blueprint = scoped.pipe(
                scoped.createContext({ count: 0 }),
                scoped.provideSync('app:local', () => ({ value: 41 })),
            )
            const session = await scoped.mount(blueprint)(element)
            expect(scoped.injectSync('app:local')(session)).toEqual({ value: 41 })
            await expect(scoped.inject('app:local')(element)).resolves.toEqual({ value: 41 })
            const seen: Array<unknown> = []
            scoped.inject$('app:local')(element).subscribe((value) => {
                seen.push(value)
            })
            await Promise.resolve()
            await Promise.resolve()
            expect(seen).toEqual([{ value: 41 }])
            scoped.dispose(session)
        } finally {
            element.remove()
        }
    })

    it('resolves a session-local async service without transport', async () => {
        const local = throwingPorts()
        const scoped = createApplication(local)
        const element = mountElement()
        try {
            const blueprint = scoped.pipe(
                scoped.createContext({ count: 0 }),
                scoped.provide('app:remote', async () => ({ id: 'r1' })),
            )
            const session = await scoped.mount(blueprint)(element)
            await expect(scoped.inject('app:remote')(element)).resolves.toEqual({ id: 'r1' })
            scoped.dispose(session)
        } finally {
            element.remove()
        }
    })

    it('returns the singleton value rather than the claim marker', async () => {
        const local = throwingPorts()
        const scoped = createApplication(local)
        const element = mountElement()
        try {
            const blueprint = scoped.pipe(
                scoped.createContext({ count: 0 }),
                scoped.provide('app:single', async () => ({ n: 1 }), { lifecycle: 'singleton' }),
            )
            const session = await scoped.mount(blueprint)(element)
            const value = await scoped.inject('app:single')(element)
            expect(value).toEqual({ n: 1 })
            expect(value).not.toHaveProperty('status')
            scoped.dispose(session)
        } finally {
            element.remove()
        }
    })

    it('collects multi registrations bottom-up and top-down without transport', async () => {
        const local = throwingPorts()
        const scoped = createApplication(local)
        const rootElement = mountElement()
        const leafElement = document.createElement('span')
        rootElement.appendChild(leafElement)
        try {
            const rootBlueprint = scoped.pipe(
                scoped.createContext({ count: 0 }),
                scoped.provideSync('app:tag', () => 'far', { multi: true }),
            )
            const leafBlueprint = scoped.pipe(
                scoped.createContext({ count: 0 }),
                scoped.provideSync('app:tag', () => 'near', { multi: true }),
            )
            const root = await scoped.mount(rootBlueprint)(rootElement)
            const leaf = await scoped.mount(leafBlueprint)(leafElement)
            expect(scoped.injectAllSync('app:tag')(leaf)).toEqual(['near', 'far'])
            expect(scoped.injectAllSync('app:tag', { direction: 'topDown' })(leaf)).toEqual(['far', 'near'])
            await expect(scoped.injectAll('app:tag')(leafElement)).resolves.toEqual(['near', 'far'])
            scoped.dispose(leaf)
            scoped.dispose(root)
        } finally {
            rootElement.remove()
        }
    })

    it('tracks sessions along the ancestor chain', async () => {
        const element = mountElement()
        try {
            const session = await mount(pipe(createContext({ count: 0 })))(element)
            expect(getSessionSync(element)).toBe(session as Session<Record<PropertyKey, unknown>, unknown>)
            const seen: Array<Session | null> = []
            const subscription = session$(element).subscribe((current) => {
                seen.push(current)
            })
            expect(seen).toEqual([session as Session | null])
            subscription.unsubscribe()
            const states: Array<{ count: number }> = []
            const stateSubscription = subscribe$((state: { count: number }) => {
                states.push(state)
            })(session as Session<{ count: number }, unknown>)
            update({ count: 3 })(session as Session<{ count: number }, unknown>)
            stateSubscription.unsubscribe()
            expect(states).toEqual([{ count: 0 }, { count: 3 }])
            const projected: Array<number> = []
            const projection = select$((state: { count: number }) => state.count)(
                session as Session<{ count: number }, unknown>,
            ).subscribe((count) => {
                projected.push(count)
            })
            projection.unsubscribe()
            expect(projected).toEqual([3])
            void onAdopt
            void onSuspend
            void onResuscitate
            void attach
            dispose(session)
        } finally {
            element.remove()
        }
    })
})
