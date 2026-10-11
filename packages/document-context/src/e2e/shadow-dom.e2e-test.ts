/**
 * E2E: service injection crossing a shadow boundary.
 *
 * Runs in happy-dom with real elements and a real shadow root. The provider
 * mounts on the shadow host in the light DOM; the consumer resolves from an
 * element inside the open shadow tree. The `context-request` channel is
 * composed, so the request escapes the shadow root and the ancestor answers,
 * proving Web Component encapsulation never blocks injection.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
    createContext,
    dispose,
    inject,
    injectAll,
    mount,
    pipe,
    provideSync,
} from '../index.js'

afterEach(() => {
    document.body.innerHTML = ''
})

describe('shadow DOM inject crossing', () => {
    it('resolves an ancestor provider from inside the shadow tree', async () => {
        const host = document.createElement('div')
        document.body.appendChild(host)
        const shadow = host.attachShadow({ mode: 'open' })
        const inner = document.createElement('span')
        shadow.appendChild(inner)
        try {
            const blueprint = pipe(
                createContext({ count: 0 }),
                provideSync('app:shadow-theme', () => 'shadow-dark'),
            )
            const session = await mount(blueprint)(host)
            try {
                await expect(inject('app:shadow-theme')(inner)).resolves.toBe('shadow-dark')
            } finally {
                dispose(session)
            }
        } finally {
            host.remove()
        }
    })

    it('collects multi providers across the shadow boundary nearest-first', async () => {
        const host = document.createElement('div')
        document.body.appendChild(host)
        const shadow = host.attachShadow({ mode: 'open' })
        const inner = document.createElement('span')
        shadow.appendChild(inner)
        const outer = document.createElement('div')
        document.body.appendChild(outer)
        outer.appendChild(host)
        try {
            const outerBlueprint = pipe(
                createContext({ count: 0 }),
                provideSync('app:shadow-tag', () => 'outer-tag', { multi: true }),
            )
            const hostBlueprint = pipe(
                createContext({ count: 0 }),
                provideSync('app:shadow-tag', () => 'host-tag', { multi: true }),
            )
            const outerSession = await mount(outerBlueprint)(outer)
            const hostSession = await mount(hostBlueprint)(host)
            try {
                await expect(injectAll('app:shadow-tag')(inner)).resolves.toEqual(['host-tag', 'outer-tag'])
            } finally {
                dispose(hostSession)
                dispose(outerSession)
            }
        } finally {
            outer.remove()
        }
    })
})
