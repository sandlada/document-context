import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createContext } from '../core/context'
import { withHook } from '../core/hooks'
import { mount } from '../core/mount'
import { pipe } from '../core/pipe'
import {
    trackElementForGC,
    startRootObserver,
    stopRootObserver,
    adoptSessionToDocument
} from './observer'

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
})
