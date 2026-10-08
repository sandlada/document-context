import { describe, expect, it } from 'vitest'
import { createContext } from '../core/context'
import { mount } from '../core/mount'
import { pipe } from '../core/pipe'
import { select } from '../core/select'
import { update } from '../core/update'
import { dispose } from '../core/dispose'
import { withBridge } from './with-bridge'
import { parseNumber } from './sanitize'
import { startRootObserver, stopRootObserver, trackElementForGC } from '../dom/observer'

async function settleMutations(): Promise<void> {
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('withBridge operator & runtime synchronization', () => {
    it('registers bridge options immutably onto blueprint', () => {
        const bp = createContext({ count: 0 })
        const enriched = withBridge<{ count: number }, {}>({
            properties: {
                count: 'dataset.count'
            }
        })(bp)

        expect(enriched.bridges.length).toBe(1)
        expect(bp.bridges.length).toBe(0)
    })

    it('synchronizes initial state to DOM properties upon mount', () => {
        const el = document.createElement('div')
        const bp = pipe(
            createContext({ count: 42, theme: 'dark' }),
            withBridge({
                properties: {
                    count: 'dataset.count',
                    theme: 'dataset.theme'
                }
            })
        )

        mount(bp)(el)

        expect(el.dataset.count).toBe('42')
        expect(el.dataset.theme).toBe('dark')
    })

    it('synchronizes JS state updates to DOM in real-time', async () => {
        const el = document.createElement('div')
        const bp = pipe(
            createContext({ count: 1 }),
            withBridge({
                properties: {
                    count: 'dataset.count'
                }
            })
        )

        const session = mount(bp)(el)
        expect(el.dataset.count).toBe('1')

        update<{ count: number }>({ count: 100 })(session)

        // Wait for microtask tick if batched
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

        expect(el.dataset.count).toBe('100')
    })

    it('synchronizes DOM input events back to JS state with type parsing', async () => {
        const input = document.createElement('input')
        input.type = 'text'
        document.body.appendChild(input)

        const bp = pipe(
            createContext({ count: 0 }),
            withBridge({
                properties: {
                    count: {
                        target: 'value',
                        parse: parseNumber
                    }
                }
            })
        )

        const session = mount(bp)(input)
        expect(input.value).toBe('0')

        // Simulate user typing in input
        input.value = '99'
        input.dispatchEvent(new Event('input', { bubbles: true }))

        await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

        expect(select((s: { count: number }) => s.count)(session)).toBe(99)

        document.body.removeChild(input)
    })

    it('cleans up event listeners and subscriptions when session is disposed', async () => {
        const input = document.createElement('input')
        document.body.appendChild(input)

        const bp = pipe(
            createContext({ count: 1 }),
            withBridge({
                properties: {
                    count: { target: 'value', parse: parseNumber }
                }
            })
        )

        const session = mount(bp)(input)
        dispose(session)

        input.value = '500'
        input.dispatchEvent(new Event('input', { bubbles: true }))

        await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

        expect(select((s: { count: number }) => s.count)(session)).toBe(1)

        document.body.removeChild(input)
    })

    it('pauses DOM writes while suspended and re-projects state on resuscitation', async () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        document.body.appendChild(el1)

        startRootObserver(document)

        const bp = pipe(
            createContext({ count: 1 }),
            withBridge({ properties: { count: 'dataset.count' } })
        )
        const session = mount(bp, { key: 'bridge-suspend', suspensionTtlMs: 2000 })(el1)
        trackElementForGC(el1, session)
        expect(el1.dataset.count).toBe('1')

        document.body.removeChild(el1)
        await settleMutations()
        expect(session.isSuspended).toBe(true)

        update<{ count: number }>({ count: 100 })(session)
        await settleMutations()
        expect(el1.dataset.count).toBe('1')

        document.body.appendChild(el2)
        const revived = mount(bp, { key: 'bridge-suspend' })(el2)

        expect(revived).toBe(session)
        expect(el2.dataset.count).toBe('100')

        document.body.removeChild(el2)
        stopRootObserver(document)
    })

    it('migrates DOM event listeners to the resuscitated host', async () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        document.body.appendChild(el1)

        startRootObserver(document)

        const bp = pipe(
            createContext({ count: 1 }),
            withBridge({
                properties: { count: { target: 'dataset.count', parse: parseNumber } }
            })
        )
        const session = mount(bp, { key: 'bridge-listeners', suspensionTtlMs: 2000 })(el1)
        trackElementForGC(el1, session)

        document.body.removeChild(el1)
        await settleMutations()
        expect(session.isSuspended).toBe(true)

        document.body.appendChild(el2)
        mount(bp, { key: 'bridge-listeners' })(el2)

        el2.dataset.count = '7'
        el2.dispatchEvent(new Event('input', { bubbles: true }))
        await settleMutations()
        expect(select((s: { count: number }) => s.count)(session)).toBe(7)

        // The former host no longer writes back to state
        el1.dataset.count = '500'
        el1.dispatchEvent(new Event('input', { bubbles: true }))
        await settleMutations()
        expect(select((s: { count: number }) => s.count)(session)).toBe(7)

        document.body.removeChild(el2)
        stopRootObserver(document)
    })
})
