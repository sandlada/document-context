import { describe, expect, it } from 'vitest'
import { createContext } from '../core/context'
import {
    CircularDependencyError,
    UnconnectedNodeError,
    UnknownServiceError
} from '../core/errors'
import { mount } from '../core/mount'
import { pipe } from '../core/pipe'
import { withProvider } from '../core/providers'
import { update } from '../core/update'
import { ContextRequestEvent } from './events'
import { clearGlobalSingletons, inject, setGlobalSingleton } from './inject'
import { startRootObserver, stopRootObserver, trackElementForGC } from './observer'

describe('inject & W3C Context Protocol', () => {
    it('resolves a service directly from an ISession', () => {
        const bp = pipe(
            createContext({}),
            withProvider('api:key', () => 'secret_123')
        )
        const el = document.createElement('div')
        const session = mount(bp)(el)

        const apiKey = inject<string>('api:key')(session)
        expect(apiKey).toBe('secret_123')
    })

    it('resolves a scoped service from an ancestor host element', () => {
        const rootEl = document.createElement('div')
        const childEl = document.createElement('div')
        rootEl.appendChild(childEl)
        document.body.appendChild(rootEl)

        const bp = pipe(
            createContext({}),
            withProvider('user:id', () => 42)
        )
        mount(bp)(rootEl)

        const userId = inject<number>('user:id')(childEl)
        expect(userId).toBe(42)

        document.body.removeChild(rootEl)
    })

    it('supports streaming subscription when subscribe: true is passed in ContextRequestEvent', () => {
        const rootEl = document.createElement('div')
        const childEl = document.createElement('div')
        rootEl.appendChild(childEl)
        document.body.appendChild(rootEl)

        const bp = createContext({ theme: 'light' })
        const session = mount(bp)(rootEl)

        const emissions: any[] = []
        let unsubscribeFn: (() => void) | undefined

        childEl.dispatchEvent(
            new ContextRequestEvent(
                'theme',
                (value, unsub) => {
                    emissions.push(value)
                    unsubscribeFn = unsub
                },
                { subscribe: true }
            )
        )

        update<{ theme: string }>({ theme: 'dark' })(session)
        expect(emissions).toContain('dark')

        if (typeof unsubscribeFn === 'function') {
            unsubscribeFn()
        }

        update<{ theme: string }>({ theme: 'sepia' })(session)
        expect(emissions).not.toContain('sepia')

        document.body.removeChild(rootEl)
    })

    it('penetrates Shadow DOM boundaries via composed: true', () => {
        const hostEl = document.createElement('div')
        const shadow = hostEl.attachShadow({ mode: 'open' })
        const innerChild = document.createElement('span')
        shadow.appendChild(innerChild)
        document.body.appendChild(hostEl)

        const bp = pipe(
            createContext({}),
            withProvider('theme', () => 'dark')
        )
        mount(bp)(hostEl)

        const theme = inject<string>('theme')(innerChild)
        expect(theme).toBe('dark')

        document.body.removeChild(hostEl)
    })

    it('throws UnconnectedNodeError when element is not connected to DOM', () => {
        const disconnectedEl = document.createElement('div')
        expect(() => {
            inject('any:token')(disconnectedEl)
        }).toThrow(UnconnectedNodeError)
    })

    it('falls back to global singletons when unconnected or not found in DOM tree', () => {
        setGlobalSingleton('global:config', { appName: 'Sandlada' })
        const isolatedEl = document.createElement('div')

        const config = inject<any>('global:config')(isolatedEl)
        expect(config).toEqual({ appName: 'Sandlada' })

        clearGlobalSingletons()
    })

    it('throws UnknownServiceError when token cannot be resolved', () => {
        const el = document.createElement('div')
        document.body.appendChild(el)

        expect(() => {
            inject('missing:token')(el)
        }).toThrow(UnknownServiceError)

        document.body.removeChild(el)
    })

    it('detects circular dependencies during injection and throws CircularDependencyError', () => {
        const bp = pipe(
            createContext({}),
            withProvider('serviceA', (s) => inject('serviceB')(s)),
            withProvider('serviceB', (s) => inject('serviceA')(s))
        )
        const el = document.createElement('div')
        const session = mount(bp)(el)

        expect(() => {
            inject('serviceA')(session)
        }).toThrow(CircularDependencyError)
    })

    it('answers context-requests on a resuscitated host', async () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        document.body.appendChild(el1)

        startRootObserver(document)

        const bp = pipe(
            createContext({}),
            withProvider('panel:token', () => 'panel-value')
        )
        const session = mount(bp, { key: 'inject-panel', suspensionTtlMs: 2000 })(el1)
        trackElementForGC(el1, session)

        document.body.removeChild(el1)
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(session.isSuspended).toBe(true)

        document.body.appendChild(el2)
        const revived = mount(bp, { key: 'inject-panel' })(el2)
        expect(revived).toBe(session)

        expect(inject<string>('panel:token')(el2)).toBe('panel-value')
        expect(inject<string>('panel:token')(session)).toBe('panel-value')

        document.body.removeChild(el2)
        stopRootObserver(document)
    })
})
