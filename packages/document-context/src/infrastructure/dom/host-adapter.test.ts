/**
 * DOM host adapter tests: duck-typed `toHost` validation, composed parent
 * chains (including Shadow DOM), live connection flags, keyed identity,
 * observer-sink tracking, native event passthrough, and adapter composition.
 *
 * Runs in happy-dom with real elements, real events, and real shadow roots.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY } from 'rxjs'
import { DocumentContextError } from '../../domain/model/errors.js'
import type { HostLifecycleEvent, HostPort } from '../../domain/ports/host.js'
import { createHostAdapter, notifyHost } from './host-adapter.js'
import type { ObserverSink } from './host-adapter.js'

afterEach(() => {
    document.body.innerHTML = ''
})

interface SinkStub extends ObserverSink {
    readonly tracked: Array<HostPort<unknown>>
    readonly untracked: Array<HostPort<unknown>>
}

const createSinkStub = (): SinkStub => {
    const tracked: Array<HostPort<unknown>> = []
    const untracked: Array<HostPort<unknown>> = []
    return {
        tracked,
        untracked,
        track(host: HostPort<unknown>): void {
            tracked.push(host)
        },
        untrack(host: HostPort<unknown>): void {
            untracked.push(host)
        },
    }
}

describe('toHost validation (duck-typing, no instanceof)', () => {
    it('rejects nullish and non-object targets with HOST_INVALID', () => {
        const adapter = createHostAdapter()
        for (const target of [null, undefined, 42, 'div', true]) {
            let error: unknown = null
            try {
                adapter.toHost(target)
            } catch (caught: unknown) {
                error = caught
            }
            expect(error).toBeInstanceOf(DocumentContextError)
            expect((error as DocumentContextError).code).toBe('HOST_INVALID')
            expect(typeof (error as DocumentContextError).details['reason']).toBe('string')
        }
    })

    it('rejects text nodes with a wrong-node-type reason', () => {
        const adapter = createHostAdapter()
        let error: unknown = null
        try {
            adapter.toHost(document.createTextNode('hello'))
        } catch (caught: unknown) {
            error = caught
        }
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('HOST_INVALID')
        expect((error as DocumentContextError).details['reason']).toBe('wrong-node-type')
    })

    it('rejects nodeType-1 impostors missing ownerDocument or isConnected', () => {
        const adapter = createHostAdapter()
        const missingOwner = { nodeType: 1, isConnected: true }
        const missingConnected = { nodeType: 1, ownerDocument: document }
        let first: unknown = null
        let second: unknown = null
        try {
            adapter.toHost(missingOwner)
        } catch (caught: unknown) {
            first = caught
        }
        try {
            adapter.toHost(missingConnected)
        } catch (caught: unknown) {
            second = caught
        }
        expect((first as DocumentContextError).code).toBe('HOST_INVALID')
        expect((first as DocumentContextError).details['reason']).toBe('missing-owner-document')
        expect((second as DocumentContextError).code).toBe('HOST_INVALID')
        expect((second as DocumentContextError).details['reason']).toBe('missing-is-connected')
    })

    it('accepts HTML elements and SVG/MathML elements alike', () => {
        const adapter = createHostAdapter()
        const div = document.createElement('div')
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        expect(adapter.toHost(div).native()).toBe(div)
        expect(adapter.toHost(svg).native()).toBe(svg)
    })

    it('returns the cached host for repeated toHost calls', () => {
        const adapter = createHostAdapter()
        const div = document.createElement('div')
        expect(adapter.toHost(div)).toBe(adapter.toHost(div))
    })
})

describe('keyed identity (data-context-key)', () => {
    it('reads the token from data-context-key at toHost time', () => {
        const adapter = createHostAdapter()
        const anonymous = document.createElement('div')
        const keyed = document.createElement('div')
        keyed.setAttribute('data-context-key', 'app:box')
        expect(adapter.toHost(anonymous).token).toBeNull()
        expect(adapter.toHost(keyed).token).toBe('app:box')
    })

    it('reads and writes the live attribute through tokens', () => {
        const adapter = createHostAdapter()
        const div = document.createElement('div')
        const host = adapter.toHost(div)
        expect(adapter.tokens.read(host)).toBeNull()
        adapter.tokens.write(host, 'app:live')
        expect(div.getAttribute('data-context-key')).toBe('app:live')
        expect(adapter.tokens.read(host)).toBe('app:live')
        adapter.tokens.write(host, null)
        expect(div.hasAttribute('data-context-key')).toBe(false)
        expect(adapter.tokens.read(host)).toBeNull()
    })
})

describe('scope chain (parent links and composed trees)', () => {
    it('walks nested parents up to a null root with stable identity', () => {
        const adapter = createHostAdapter()
        const root = document.createElement('div')
        const middle = document.createElement('div')
        const leaf = document.createElement('span')
        middle.appendChild(leaf)
        root.appendChild(middle)
        const leafHost = adapter.toHost(leaf)
        expect(leafHost.parent).toBe(adapter.toHost(middle))
        expect(leafHost.parent?.parent).toBe(adapter.toHost(root))
        expect(adapter.toHost(root).parent).toBeNull()
        document.body.appendChild(root)
        expect(adapter.toHost(root).parent).toBe(adapter.toHost(document.body))
    })

    it('crosses an open shadow boundary via ShadowRoot.host', () => {
        const adapter = createHostAdapter()
        const host = document.createElement('div')
        document.body.appendChild(host)
        const shadow = host.attachShadow({ mode: 'open' })
        const inner = document.createElement('span')
        shadow.appendChild(inner)
        expect(adapter.toHost(inner).parent).toBe(adapter.toHost(host))
    })

    it('crosses a closed shadow boundary via ShadowRoot.host', () => {
        const adapter = createHostAdapter()
        const host = document.createElement('div')
        document.body.appendChild(host)
        const shadow = host.attachShadow({ mode: 'closed' })
        const inner = document.createElement('span')
        shadow.appendChild(inner)
        expect(adapter.toHost(inner).parent).toBe(adapter.toHost(host))
    })
})

describe('connection and lifecycle', () => {
    it('reflects isConnected live on the same host object', () => {
        const adapter = createHostAdapter()
        const div = document.createElement('div')
        const host = adapter.toHost(div)
        expect(host.isConnected).toBe(false)
        document.body.appendChild(div)
        expect(host.isConnected).toBe(true)
        div.remove()
        expect(host.isConnected).toBe(false)
    })

    it('delivers connect, adopt, and disconnect events pushed via notifyHost', () => {
        const adapter = createHostAdapter()
        const div = document.createElement('div')
        const host = adapter.toHost(div)
        const events: Array<HostLifecycleEvent> = []
        const subscription = host.lifecycle$.subscribe((event) => {
            events.push(event)
        })
        notifyHost(host, { type: 'connect' })
        const owner = { name: 'owner-document' }
        notifyHost(host, { type: 'adopt', owner })
        notifyHost(host, { type: 'disconnect' })
        expect(events).toEqual([
            { type: 'connect' },
            { type: 'adopt', owner },
            { type: 'disconnect' },
        ])
        subscription.unsubscribe()
    })

    it('ignores notifyHost for unknown hosts without throwing', () => {
        const unknown = {} as unknown as HostPort<unknown>
        expect(() => {
            notifyHost(unknown, { type: 'connect' })
        }).not.toThrow()
    })
})

describe('observer sink tracking', () => {
    it('tracks every toHost-created host exactly once', () => {
        const sink = createSinkStub()
        const adapter = createHostAdapter({ sink })
        const first = document.createElement('div')
        const second = document.createElement('div')
        const firstHost = adapter.toHost(first)
        adapter.toHost(first)
        adapter.toHost(second)
        expect(sink.tracked).toEqual([firstHost, adapter.toHost(second)])
    })

    it('tracks parent hosts created lazily through the parent getter', () => {
        const sink = createSinkStub()
        const adapter = createHostAdapter({ sink })
        const root = document.createElement('div')
        const leaf = document.createElement('span')
        root.appendChild(leaf)
        const leafHost = adapter.toHost(leaf)
        expect(sink.tracked).toEqual([leafHost])
        const parent = leafHost.parent
        expect(parent).not.toBeNull()
        expect(sink.tracked).toEqual([leafHost, parent])
    })
})

describe('native event passthrough (on)', () => {
    it('delivers native events until the off function runs', () => {
        const adapter = createHostAdapter()
        const div = document.createElement('div')
        document.body.appendChild(div)
        const host = adapter.toHost(div)
        const seen: Array<unknown> = []
        const off = host.on('input', (event) => {
            seen.push(event)
        })
        div.dispatchEvent(new Event('input', { bubbles: true }))
        expect(seen).toHaveLength(1)
        off()
        off()
        div.dispatchEvent(new Event('input', { bubbles: true }))
        expect(seen).toHaveLength(1)
    })

    it('honours capture, passive, and once options', () => {
        const adapter = createHostAdapter()
        const div = document.createElement('div')
        document.body.appendChild(div)
        const host = adapter.toHost(div)
        let calls = 0
        host.on('input', () => {
            calls += 1
        }, { capture: true, passive: true, once: true })
        div.dispatchEvent(new Event('input', { bubbles: true }))
        div.dispatchEvent(new Event('input', { bubbles: true }))
        expect(calls).toBe(1)
    })

    it('never attaches when the signal is already aborted', () => {
        const adapter = createHostAdapter()
        const div = document.createElement('div')
        document.body.appendChild(div)
        const host = adapter.toHost(div)
        let calls = 0
        const off = host.on('input', () => {
            calls += 1
        }, { signal: AbortSignal.abort() })
        div.dispatchEvent(new Event('input', { bubbles: true }))
        expect(calls).toBe(0)
        off()
    })

    it('detaches when the signal aborts later', () => {
        const adapter = createHostAdapter()
        const div = document.createElement('div')
        document.body.appendChild(div)
        const host = adapter.toHost(div)
        let calls = 0
        const controller = new AbortController()
        host.on('input', () => {
            calls += 1
        }, { signal: controller.signal })
        controller.abort()
        div.dispatchEvent(new Event('input', { bubbles: true }))
        expect(calls).toBe(0)
    })
})

describe('adapter composition', () => {
    it('exposes a working scheduler and a scope transport with miss semantics', () => {
        const adapter = createHostAdapter()
        expect(typeof adapter.scheduler.microtask).toBe('function')
        expect(typeof adapter.scheduler.timeout).toBe('function')
        expect(typeof adapter.scheduler.frame).toBe('function')
        const div = document.createElement('div')
        document.body.appendChild(div)
        const host = adapter.toHost(div)
        expect(adapter.scopeTransport.request('app:missing', host)).toBeNull()
        expect(adapter.scopeTransport.requestAll('app:missing', host)).toEqual([])
    })
})

describe('token I/O and parent edge cases', () => {
    it('reads null for natives without an attribute API', () => {
        const adapter = createHostAdapter()
        const attrLess = {
            token: null,
            isConnected: true,
            parent: null,
            lifecycle$: EMPTY,
            on: () => () => {},
            native: () => ({}),
        }
        expect(adapter.tokens.read(attrLess as unknown as HostPort<HTMLElement>)).toBeNull()
    })

    it('throws HOST_INVALID when writing to natives without an attribute API', () => {
        const adapter = createHostAdapter()
        const attrLess: HostPort<HTMLElement> = {
            token: null,
            isConnected: true,
            parent: null,
            lifecycle$: EMPTY,
            on: () => () => {},
            native: () => ({}) as unknown as HTMLElement,
        }
        let error: unknown = null
        try {
            adapter.tokens.write(attrLess, 'app:key')
        } catch (caught: unknown) {
            error = caught
        }
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('HOST_INVALID')
    })

    it('resolves null parents for exotic structures', () => {
        const adapter = createHostAdapter()
        const detached = document.createElement('div')
        expect(adapter.toHost(detached).parent).toBeNull()
        const shadowHost = document.createElement('div')
        document.body.appendChild(shadowHost)
        const shadow = shadowHost.attachShadow({ mode: 'open' })
        const inner = document.createElement('span')
        shadow.appendChild(inner)
        Object.defineProperty(inner, 'parentElement', { value: { nodeType: 3 }, configurable: true })
        try {
            expect(adapter.toHost(inner).parent).toBe(adapter.toHost(shadowHost))
        } finally {
            delete (inner as unknown as Record<string, unknown>)['parentElement']
        }
        const rootless = document.createElement('div')
        Object.defineProperty(rootless, 'getRootNode', { value: 42, configurable: true })
        try {
            expect(adapter.toHost(rootless).parent).toBeNull()
        } finally {
            delete (rootless as unknown as Record<string, unknown>)['getRootNode']
        }
        const nullRoot = document.createElement('div')
        Object.defineProperty(nullRoot, 'getRootNode', {
            value: () => null,
            configurable: true,
        })
        try {
            expect(adapter.toHost(nullRoot).parent).toBeNull()
        } finally {
            delete (nullRoot as unknown as Record<string, unknown>)['getRootNode']
        }
    })
})
