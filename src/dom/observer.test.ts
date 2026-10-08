import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createContext } from '../core/context'
import { withHook } from '../core/hooks'
import { mount } from '../core/mount'
import { pipe } from '../core/pipe'
import { findKeyedSession } from '../core/resuscitation'
import { select } from '../core/select'
import { update } from '../core/update'
import { withBridge } from '../bridge/with-bridge'
import { parseNumber } from '../bridge/sanitize'
import {
    trackElementForGC,
    startRootObserver,
    stopRootObserver,
    adoptSessionToDocument
} from './observer'

async function settleMutations(): Promise<void> {
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('CentralizedRootObserver & Zero-Leak GC', () => {
    beforeEach(() => {
        startRootObserver(document)
    })

    afterEach(() => {
        stopRootObserver(document)
    })

    it('automatically disposes anonymous session when element is disconnected from DOM', async () => {
        const el = document.createElement('div')
        document.body.appendChild(el)

        let disposeHookCalled = false
        const bp = pipe(
            createContext({}),
            withHook('dispose', () => {
                disposeHookCalled = true
            })
        )

        const session = mount(bp)(el)
        trackElementForGC(el, session)

        expect(session.isDisposed).toBe(false)

        document.body.removeChild(el)

        // Wait for microtask tick
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(session.isDisposed).toBe(true)
        expect(disposeHookCalled).toBe(true)
    })

    it('prevents premature disposal during microtask reparenting (DOM move / drag-and-drop)', async () => {
        const container1 = document.createElement('div')
        const container2 = document.createElement('div')
        const item = document.createElement('div')

        container1.appendChild(item)
        document.body.appendChild(container1)
        document.body.appendChild(container2)

        const bp = createContext({ count: 1 })
        const session = mount(bp)(item)
        trackElementForGC(item, session)

        // Reparent synchronously within same microtask
        container1.removeChild(item)
        container2.appendChild(item)

        await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(item.isConnected).toBe(true)
        expect(session.isDisposed).toBe(false)

        document.body.removeChild(container1)
        document.body.removeChild(container2)
    })

    it('handles child descendant removal when parent or grandparent is cleared via innerHTML', async () => {
        const parent = document.createElement('div')
        const child = document.createElement('div')
        parent.appendChild(child)
        document.body.appendChild(parent)

        const bp = createContext({})
        const session = mount(bp)(child)
        trackElementForGC(child, session)

        parent.innerHTML = ''

        await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(child.isConnected).toBe(false)
        expect(session.isDisposed).toBe(true)

        document.body.removeChild(parent)
    })

    it('handles cross-document adoption via adoptSessionToDocument', () => {
        const el = document.createElement('div')
        document.body.appendChild(el)

        let adoptCalled = false
        const bp = pipe(
            createContext({}),
            withHook('adopt', (s, newDoc) => {
                adoptCalled = true
            })
        )

        const session = mount(bp)(el)
        trackElementForGC(el, session)

        const newDoc = document.implementation.createHTMLDocument('new-doc')
        let eventFired = false
        el.addEventListener('context-adopt', () => {
            eventFired = true
        })

        adoptSessionToDocument(session, newDoc)

        expect(adoptCalled).toBe(true)
        expect(eventFired).toBe(true)

        document.body.removeChild(el)
    })

    it('parks a keyed session in the suspended state on disconnect', async () => {
        const el = document.createElement('div')
        document.body.appendChild(el)

        const hookEvents: string[] = []
        let suspendDetail: any = null
        el.addEventListener('context-suspend', (e: any) => {
            suspendDetail = e.detail
        })

        const bp = pipe(
            createContext({ count: 0 }),
            withHook('suspend', () => {
                hookEvents.push('suspend')
            })
        )

        const session = mount(bp, { key: 'observer-suspend', suspensionTtlMs: 2000 })(el)
        trackElementForGC(el, session)

        document.body.removeChild(el)
        await settleMutations()

        expect(session.isSuspended).toBe(true)
        expect(session.isDisposed).toBe(false)
        expect(hookEvents).toEqual(['suspend'])
        expect(suspendDetail).toEqual({ sessionKey: 'observer-suspend', ttl: 2000 })
        expect(findKeyedSession('observer-suspend', el.ownerDocument)).toBe(session)
    })

    it('auto-resumes the same host node when it is reconnected', async () => {
        const el = document.createElement('div')
        document.body.appendChild(el)

        const hookEvents: string[] = []
        let resuscitateEventFired = false
        el.addEventListener('context-resuscitate', () => {
            resuscitateEventFired = true
        })

        const bp = pipe(
            createContext({ count: 1 }),
            withHook('suspend', () => {
                hookEvents.push('suspend')
            }),
            withHook('resuscitate', () => {
                hookEvents.push('resuscitate')
            })
        )

        const session = mount(bp, { key: 'observer-reconnect', suspensionTtlMs: 2000 })(el)
        trackElementForGC(el, session)

        document.body.removeChild(el)
        await settleMutations()
        expect(session.isSuspended).toBe(true)

        document.body.appendChild(el)
        await settleMutations()

        expect(session.isSuspended).toBe(false)
        expect(session.target).toBe(el)
        expect(hookEvents).toEqual(['suspend', 'resuscitate'])
        expect(resuscitateEventFired).toBe(true)

        document.body.removeChild(el)
    })

    it('does not adopt a different node that appears with the same key', async () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        el2.setAttribute('data-context-key', 'observer-no-adopt')
        document.body.appendChild(el1)

        const bp = createContext({ count: 0 })
        const session = mount(bp, { key: 'observer-no-adopt', suspensionTtlMs: 2000 })(el1)
        trackElementForGC(el1, session)

        document.body.removeChild(el1)
        await settleMutations()
        expect(session.isSuspended).toBe(true)

        document.body.appendChild(el2)
        await settleMutations()

        expect(session.isSuspended).toBe(true)
        expect(session.target).toBe(el1)

        document.body.removeChild(el2)
    })

    it('disposes a suspended session and clears its registry entry after the TTL', async () => {
        const el = document.createElement('div')
        document.body.appendChild(el)

        const bp = createContext({ count: 0 })
        const session = mount(bp, { key: 'observer-ttl', suspensionTtlMs: 20 })(el)
        trackElementForGC(el, session)

        document.body.removeChild(el)
        await settleMutations()
        expect(session.isSuspended).toBe(true)

        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(session.isDisposed).toBe(true)
        expect(findKeyedSession('observer-ttl', el.ownerDocument)).toBeUndefined()
    })

    it('disposes immediately with suspensionTtlMs 0 and skips suspend hooks', async () => {
        const el = document.createElement('div')
        document.body.appendChild(el)

        const hookEvents: string[] = []
        let suspendEventFired = false
        el.addEventListener('context-suspend', () => {
            suspendEventFired = true
        })

        const bp = pipe(
            createContext({ count: 0 }),
            withHook('suspend', () => {
                hookEvents.push('suspend')
            })
        )

        const session = mount(bp, { key: 'observer-zero', suspensionTtlMs: 0 })(el)
        trackElementForGC(el, session)

        document.body.removeChild(el)
        await settleMutations()

        expect(session.isDisposed).toBe(true)
        expect(session.isSuspended).toBe(false)
        expect(hookEvents).toEqual([])
        expect(suspendEventFired).toBe(false)
    })

    it('never auto-disposes with suspensionTtlMs Infinity', async () => {
        const el = document.createElement('div')
        document.body.appendChild(el)

        const bp = createContext({ count: 0 })
        const session = mount(bp, { key: 'observer-infinity', suspensionTtlMs: Infinity })(el)
        trackElementForGC(el, session)

        document.body.removeChild(el)
        await settleMutations()
        expect(session.isSuspended).toBe(true)

        await new Promise((resolve) => setTimeout(resolve, 60))
        expect(session.isDisposed).toBe(false)

        document.body.appendChild(el)
        await settleMutations()
        expect(session.isSuspended).toBe(false)

        document.body.removeChild(el)
    })

    it('performs a full HTMX-style swap: suspend, revive on a new node, project latest state', async () => {
        const el1 = document.createElement('div')
        document.body.appendChild(el1)

        const bp = pipe(
            createContext({ count: 0 }),
            withBridge({ properties: { count: { target: 'dataset.count', parse: parseNumber } } })
        )
        const mountPanel = mount(bp, { key: 'observer-htmx', suspensionTtlMs: 2000 })
        const session = mountPanel(el1)
        trackElementForGC(el1, session)
        expect(el1.dataset.count).toBe('0')

        document.body.removeChild(el1)
        await settleMutations()
        expect(session.isSuspended).toBe(true)

        update<{ count: number }>({ count: 42 })(session)
        await settleMutations()
        // DOM writes are paused on the detached old host
        expect(el1.dataset.count).toBe('0')

        const el2 = document.createElement('div')
        document.body.appendChild(el2)
        const revived = mountPanel(el2)

        expect(revived).toBe(session)
        expect(el2.dataset.count).toBe('42')
        expect(session.target).toBe(el2)

        el2.dataset.count = '7'
        el2.dispatchEvent(new Event('input', { bubbles: true }))
        await settleMutations()
        expect(select((s: { count: number }) => s.count)(session)).toBe(7)

        document.body.removeChild(el2)
    })

    it('migrates the keyed registry entry on cross-document adoption', () => {
        const el = document.createElement('div')
        document.body.appendChild(el)

        const bp = createContext({})
        const session = mount(bp, { key: 'observer-adopt-keyed' })(el)
        trackElementForGC(el, session)

        const newDoc = document.implementation.createHTMLDocument('new-doc')
        adoptSessionToDocument(session, newDoc)

        expect(findKeyedSession('observer-adopt-keyed', newDoc)).toBe(session)
        expect(findKeyedSession('observer-adopt-keyed', document)).toBeUndefined()

        document.body.removeChild(el)
    })

    it('keeps the bridge syncing through a same-node reconnect', async () => {
        const el = document.createElement('div')
        document.body.appendChild(el)

        const bp = pipe(
            createContext({ count: 5 }),
            withBridge({ properties: { count: 'dataset.count' } })
        )
        const session = mount(bp, { key: 'observer-bridge-reconnect', suspensionTtlMs: 2000 })(el)
        trackElementForGC(el, session)

        document.body.removeChild(el)
        await settleMutations()
        expect(session.isSuspended).toBe(true)

        update<{ count: number }>({ count: 9 })(session)
        await settleMutations()

        document.body.appendChild(el)
        await settleMutations()

        expect(session.isSuspended).toBe(false)
        expect(el.dataset.count).toBe('9')

        document.body.removeChild(el)
    })
})
