/**
 * Integration: two independently assembled applications sharing one document.
 *
 * Runs in happy-dom. Proves the cross-bundle contract: bundle A mounts a
 * provider on an ancestor element while bundle B — a separate
 * `createApplication` with its own DOM adapter, session index, and singleton
 * slots — resolves that provider from a descendant through the shared DOM
 * `context-request` channel. State stays isolated per bundle.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
    app as bundleA,
    createApplication,
} from '../index.js'
import type { Application } from '../index.js'
import type { HostAdapter } from '../application/context.js'
import type { HostPort, SchedulerPort, ScopeTransportPort } from '../domain/index.js'
import { createDomAdapter } from '../infrastructure/dom/index.js'
import type { DomAdapter } from '../infrastructure/dom/index.js'
import { createStorageAdapters } from '../infrastructure/storage/index.js'

interface Bundle {
    readonly app: Application
    readonly dom: DomAdapter
    readonly storage: { close(): void }
}

const assembleBundle = (): Bundle => {
    const dom = createDomAdapter()
    const storage = createStorageAdapters()
    const host: HostAdapter = {
        toHost: (node: unknown): HostPort => dom.toHost(node) as unknown as HostPort,
        get scheduler(): SchedulerPort {
            return dom.scheduler
        },
        get scopeTransport(): ScopeTransportPort {
            return dom.scopeTransport
        },
        tokens: {
            read: (native: unknown): string | null => dom.tokens.read(dom.toHost(native)),
            write: (native: unknown, token: string | null): void => {
                dom.tokens.write(dom.toHost(native), token)
            },
        },
    }
    return { app: createApplication({ host, storage }), dom, storage }
}

afterEach(() => {
    document.body.innerHTML = ''
})

describe('cross-bundle flows', () => {
    it('resolves a bundle-A provider from a bundle-B descendant through the DOM channel', async () => {
        const dom = createDomAdapter()
        const storage = createStorageAdapters()
        const host2: HostAdapter = {
            toHost: (node: unknown): HostPort => dom.toHost(node) as unknown as HostPort,
            get scheduler(): SchedulerPort {
                return dom.scheduler
            },
            get scopeTransport(): ScopeTransportPort {
                return dom.scopeTransport
            },
            tokens: {
                read: (native: unknown): string | null => dom.tokens.read(dom.toHost(native)),
                write: (native: unknown, token: string | null): void => {
                    dom.tokens.write(dom.toHost(native), token)
                },
            },
        }
        const appB = createApplication({ host: host2, storage })
        const root = document.createElement('div')
        const leaf = document.createElement('span')
        root.appendChild(leaf)
        document.body.appendChild(root)
        try {
            const blueprint = bundleA.pipe(
                bundleA.createContext({ count: 0 }),
                bundleA.provideSync('app:cross-descendant', () => 'dark-from-a'),
            )
            const sessionA = await bundleA.mount(blueprint)(root)
            try {
                await expect(appB.inject('app:cross-descendant')(leaf)).resolves.toBe('dark-from-a')
            } finally {
                bundleA.dispose(sessionA)
            }
        } finally {
            dom.dispose()
            storage.close()
            root.remove()
        }
    })

    it('keeps session state isolated while sharing services across bundles', async () => {
        const bundleB = assembleBundle()
        const root = document.createElement('div')
        document.body.appendChild(root)
        const other = document.createElement('div')
        document.body.appendChild(other)
        try {
            const blueprintA = bundleA.pipe(bundleA.createContext({ count: 0 }))
            const blueprintB = bundleB.app.pipe(bundleB.app.createContext({ count: 100 }))
            const sessionA = await bundleA.mount(blueprintA)(root)
            const sessionB = await bundleB.app.mount(blueprintB)(other)
            try {
                bundleA.update({ count: 5 })(sessionA)
                expect(bundleA.selectSync((state: { count: number }) => state.count)(sessionA)).toBe(5)
                expect(bundleB.app.selectSync((state: { count: number }) => state.count)(sessionB)).toBe(100)
            } finally {
                bundleA.dispose(sessionA)
                bundleB.app.dispose(sessionB)
            }
        } finally {
            bundleB.dom.dispose()
            bundleB.storage.close()
            root.remove()
            other.remove()
        }
    })

    it('stops cross-bundle resolution after the providing session disposes', async () => {
        const bundleB = assembleBundle()
        const root = document.createElement('div')
        const leaf = document.createElement('span')
        root.appendChild(leaf)
        document.body.appendChild(root)
        try {
            const providerBlueprint = bundleA.pipe(
                bundleA.createContext({ count: 0 }),
                bundleA.provideSync('app:cross-ephemeral', () => 'gone-soon'),
            )
            const sessionA = await bundleA.mount(providerBlueprint)(root)
            await expect(bundleB.app.inject('app:cross-ephemeral')(leaf)).resolves.toBe('gone-soon')
            bundleA.dispose(sessionA)
            await expect(
                bundleB.app.inject('app:cross-ephemeral', { timeoutMs: 10 })(leaf),
            ).rejects.toMatchObject({ code: 'RESOLUTION_TIMEOUT' })
        } finally {
            bundleB.dom.dispose()
            bundleB.storage.close()
            root.remove()
        }
    })
})

