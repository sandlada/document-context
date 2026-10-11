/**
 * Integration: SSR `serialize` to payload to hydrate round-trip through the
 * assembled application.
 *
 * Runs in happy-dom. A live session is serialized to an embed-safe payload
 * string, embedded as a `<script type="application/json">` element under the
 * `payloadIdFor` id, and a fresh keyed mount on another element hydrates
 * from that payload. A second case proves escaping keeps hostile markup
 * embed-safe while parsing back to the original state.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
    createContext,
    dispose,
    mount,
    pipe,
    selectSync,
    serialize,
    update,
} from '../index.js'
import { payloadIdFor } from '../infrastructure/ssr/payload-resolver.js'

afterEach(() => {
    document.body.innerHTML = ''
})

const mountElement = (): HTMLDivElement => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    return element
}

const embedPayload = (token: string | null, payload: string): HTMLScriptElement => {
    const script = document.createElement('script')
    script.type = 'application/json'
    script.id = payloadIdFor(token)
    script.textContent = payload
    document.body.appendChild(script)
    return script
}

describe('ssr round-trip', () => {
    it('serializes a live session and hydrates a keyed mount from the embedded payload', async () => {
        const source = mountElement()
        const target = mountElement()
        try {
            const session = await mount(pipe(createContext({ count: 0, label: 'seed' })))(source)
            try {
                update({ count: 6, label: 'server-state' })(session)
                const payload = serialize()(session)
                expect(JSON.parse(payload)).toEqual({ count: 6, label: 'server-state' })
                embedPayload('app:ssr-cart', payload)

                const hydrated = await mount(
                    pipe(createContext({ count: 0, label: 'seed' })),
                    { token: 'app:ssr-cart' },
                )(target)
                try {
                    expect(selectSync((state: { count: number }) => state.count)(hydrated)).toBe(6)
                    expect(selectSync((state: { label: string }) => state.label)(hydrated)).toBe('server-state')
                } finally {
                    dispose(hydrated)
                }
            } finally {
                dispose(session)
            }
        } finally {
            source.remove()
            target.remove()
        }
    })

    it('keeps hostile markup embed-safe while parsing back to the original state', async () => {
        const source = mountElement()
        const target = mountElement()
        const hostile = '</script><b>&amp;</b>'
        try {
            const session = await mount(pipe(createContext({ count: 1, label: hostile })))(source)
            try {
                const payload = serialize()(session)
                expect(payload.includes('<')).toBe(false)
                expect(payload.includes('>')).toBe(false)
                expect(JSON.parse(payload)).toEqual({ count: 1, label: hostile })
                embedPayload('app:ssr-hostile', payload)

                const hydrated = await mount(
                    pipe(createContext({ count: 0, label: 'seed' })),
                    { token: 'app:ssr-hostile' },
                )(target)
                try {
                    expect(selectSync((state: { label: string }) => state.label)(hydrated)).toBe(hostile)
                } finally {
                    dispose(hydrated)
                }
            } finally {
                dispose(session)
            }
        } finally {
            source.remove()
            target.remove()
        }
    })

    it('falls back to the seed when no payload element exists', async () => {
        const element = mountElement()
        try {
            const session = await mount(
                pipe(createContext({ count: 3 })),
                { token: 'app:ssr-absent' },
            )(element)
            try {
                expect(selectSync((state: { count: number }) => state.count)(session)).toBe(3)
            } finally {
                dispose(session)
            }
        } finally {
            element.remove()
        }
    })
})
