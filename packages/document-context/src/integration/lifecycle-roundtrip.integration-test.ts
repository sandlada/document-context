/**
 * Integration: full lifecycle round-trip over the assembled application.
 *
 * Runs in happy-dom. Proves mount, service injection, state update,
 * persistence declaration, and serialization compose end to end through the
 * default wired entry (`src/index.js`): one blueprint carries a provider and
 * a persistence slot backed by the deterministic domain fake, then a single
 * session exercises every verb in sequence.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
    createContext,
    dispose,
    inject,
    injectSync,
    mount,
    persist,
    pipe,
    provideSync,
    selectSync,
    serialize,
    update,
} from '../index.js'
import { createFakeStorage } from '../domain/testing/fakes.js'

afterEach(() => {
    document.body.innerHTML = ''
})

const mountElement = (): HTMLDivElement => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    return element
}

describe('lifecycle round-trip', () => {
    it('mounts, hydrates persistence, injects, updates, serializes, and disposes in sequence', async () => {
        const element = mountElement()
        const backend = createFakeStorage()
        await backend.port.write('app:roundtrip', JSON.stringify({ v: 0, d: { count: 9 } }))
        try {
            const blueprint = pipe(
                createContext({ count: 0 }),
                provideSync('app:roundtrip-logger', () => ({ prefix: 'counter' })),
                persist({ storage: backend.port, key: 'app:roundtrip' }),
            )
            const session = await mount(blueprint)(element)
            expect(session.isDisposed).toBe(false)
            expect(selectSync((state: { count: number }) => state.count)(session)).toBe(9)

            expect(injectSync('app:roundtrip-logger')(session)).toEqual({ prefix: 'counter' })
            await expect(inject('app:roundtrip-logger')(element)).resolves.toEqual({ prefix: 'counter' })

            expect(update({ count: 10 })(session)).toBe(true)
            expect(update((state: { count: number }) => ({ count: state.count + 1 }))(session)).toBe(true)
            expect(selectSync((state: { count: number }) => state.count)(session)).toBe(11)

            expect(serialize()(session)).toBe('{"count":11}')

            dispose(session)
            expect(session.isDisposed).toBe(true)
            expect(update({ count: 99 })(session)).toBe(false)
        } finally {
            element.remove()
        }
    })

    it('writes the keyed identity back to the host and clears it on dispose', async () => {
        const element = mountElement()
        try {
            const blueprint = pipe(createContext({ count: 0 }))
            const session = await mount(blueprint, { token: 'app:roundtrip-keyed' })(element)
            try {
                expect(session.token).toBe('app:roundtrip-keyed')
                expect(element.getAttribute('data-context-key')).toBe('app:roundtrip-keyed')
            } finally {
                dispose(session)
            }
            expect(element.hasAttribute('data-context-key')).toBe(false)
            expect(session.isDisposed).toBe(true)
        } finally {
            element.remove()
        }
    })

    it('serializes a live projection rather than the seed', async () => {
        const element = mountElement()
        try {
            const session = await mount(pipe(createContext({ count: 0, label: 'seed' })))(element)
            try {
                update({ count: 4, label: 'live' })(session)
                expect(serialize()(session)).toBe('{"count":4,"label":"live"}')
                expect(serialize({ select: (state: { count: number }) => state.count })(session)).toBe('4')
            } finally {
                dispose(session)
            }
        } finally {
            element.remove()
        }
    })
})
