import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY } from 'rxjs'
import { createObserver } from './observer.js'
import type { HostLifecycleEvent, HostPort } from '../../domain/ports/host.js'

type Dispatch = (host: HostPort, event: HostLifecycleEvent) => void

const stubHost = (element: Element, token: string | null = null): HostPort => ({
    token,
    get isConnected() {
        return element.isConnected
    },
    parent: null,
    lifecycle$: EMPTY,
    on: () => () => {},
    native: () => element,
})

const flushMutations = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 0)
    })
}

const disposers: Array<() => void> = []

afterEach(() => {
    while (disposers.length > 0) {
        const dispose = disposers.pop() as () => void
        dispose()
    }
    document.body.innerHTML = ''
})

const trackObserver = (
    dispatch: Dispatch,
    onKeyChange?: (host: HostPort, key: string | null) => void,
    onStructureChange?: () => void,
) => {
    const observer = createObserver({
        dispatch,
        ...(onKeyChange === undefined ? {} : { onKeyChange }),
        ...(onStructureChange === undefined ? {} : { onStructureChange }),
    })
    disposers.push(() => observer.dispose())
    return observer
}

describe('createObserver', () => {
    it('exposes the frozen ObserverSink shape with stable identity', () => {
        const observer = trackObserver(() => {})
        const sink = observer.asSink()
        expect(typeof sink.track).toBe('function')
        expect(typeof sink.untrack).toBe('function')
        expect(observer.asSink()).toBe(sink)
    })

    it('dispatches connect when a tracked detached host is inserted', async () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const element = document.createElement('div')
        const host = stubHost(element)
        observer.asSink().track(host)
        document.body.appendChild(element)
        await flushMutations()
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch.mock.calls[0]?.[0]).toBe(host)
        expect(dispatch.mock.calls[0]?.[1]).toEqual({ type: 'connect' })
    })

    it('dispatches disconnect when a tracked connected host is removed', async () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const element = document.createElement('div')
        document.body.appendChild(element)
        const host = stubHost(element)
        observer.asSink().track(host)
        element.remove()
        await flushMutations()
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch.mock.calls[0]?.[1]).toEqual({ type: 'disconnect' })
    })

    it('treats a synchronous remove plus re-append as never left (reparent grace)', async () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const element = document.createElement('div')
        document.body.appendChild(element)
        observer.asSink().track(stubHost(element))
        element.remove()
        document.body.appendChild(element)
        await flushMutations()
        expect(dispatch).not.toHaveBeenCalled()
    })

    it('coalesces an insert plus remove burst back to no event', async () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const element = document.createElement('div')
        observer.asSink().track(stubHost(element))
        document.body.appendChild(element)
        element.remove()
        await flushMutations()
        expect(dispatch).not.toHaveBeenCalled()
    })

    it('stops dispatching after untrack', async () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const element = document.createElement('div')
        document.body.appendChild(element)
        const host = stubHost(element)
        observer.asSink().track(host)
        observer.asSink().untrack(host)
        element.remove()
        await flushMutations()
        expect(dispatch).not.toHaveBeenCalled()
    })

    it('ignores mutations on untracked elements', async () => {
        const dispatch = vi.fn()
        trackObserver(dispatch)
        const element = document.createElement('div')
        document.body.appendChild(element)
        element.remove()
        await flushMutations()
        expect(dispatch).not.toHaveBeenCalled()
    })

    it('dispose stops observation and is idempotent', async () => {
        const dispatch = vi.fn()
        const observer = createObserver({ dispatch })
        const element = document.createElement('div')
        document.body.appendChild(element)
        observer.asSink().track(stubHost(element))
        observer.dispose()
        observer.dispose()
        element.remove()
        await flushMutations()
        expect(dispatch).not.toHaveBeenCalled()
    })

    it('suspend pauses dispatch and observe converges on resume', async () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const element = document.createElement('div')
        document.body.appendChild(element)
        observer.asSink().track(stubHost(element))
        observer.suspend()
        element.remove()
        await flushMutations()
        expect(dispatch).not.toHaveBeenCalled()
        observer.observe()
        await flushMutations()
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch.mock.calls[0]?.[1]).toEqual({ type: 'disconnect' })
    })

    it('filters self-written data-context-key values without waking', async () => {
        const dispatch = vi.fn()
        const onKeyChange = vi.fn()
        const observer = trackObserver(dispatch, onKeyChange)
        const element = document.createElement('div')
        document.body.appendChild(element)
        observer.asSink().track(stubHost(element, 'app:box'))
        element.setAttribute('data-context-key', 'app:box')
        await flushMutations()
        expect(onKeyChange).not.toHaveBeenCalled()
        expect(dispatch).not.toHaveBeenCalled()
    })

    it('reports externally written keys through onKeyChange', async () => {
        const onKeyChange = vi.fn()
        const observer = trackObserver(() => {}, onKeyChange)
        const element = document.createElement('div')
        document.body.appendChild(element)
        const host = stubHost(element, 'app:box')
        observer.asSink().track(host)
        element.setAttribute('data-context-key', 'app:other')
        await flushMutations()
        expect(onKeyChange).toHaveBeenCalledTimes(1)
        expect(onKeyChange.mock.calls[0]?.[0]).toBe(host)
        expect(onKeyChange.mock.calls[0]?.[1]).toBe('app:other')
        element.removeAttribute('data-context-key')
        await flushMutations()
        expect(onKeyChange).toHaveBeenCalledTimes(2)
        expect(onKeyChange.mock.calls[1]?.[1]).toBeNull()
    })

    it('ignores key mutations on elements with no tracked host', async () => {
        const onKeyChange = vi.fn()
        trackObserver(() => {}, onKeyChange)
        const element = document.createElement('div')
        document.body.appendChild(element)
        element.setAttribute('data-context-key', 'app:ghost')
        await flushMutations()
        expect(onKeyChange).not.toHaveBeenCalled()
    })

    it('detects adoption into a new document through an explicit recheck', () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const element = document.createElement('div')
        document.body.appendChild(element)
        const host = stubHost(element)
        observer.asSink().track(host)
        const other = document.implementation.createHTMLDocument('adopt-target')
        other.body.appendChild(element)
        observer.recheck(host)
        expect(dispatch).toHaveBeenCalledTimes(1)
        const event = dispatch.mock.calls[0]?.[1]
        expect(event?.type).toBe('adopt')
        expect(event !== undefined && 'owner' in event ? event.owner : null).toBe(other)
    })

    it('recheck with a host argument scopes the pass to that host', () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const first = document.createElement('div')
        const second = document.createElement('div')
        document.body.appendChild(first)
        document.body.appendChild(second)
        const firstHost = stubHost(first)
        observer.asSink().track(firstHost)
        observer.asSink().track(stubHost(second))
        first.remove()
        observer.recheck(firstHost)
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch.mock.calls[0]?.[0]).toBe(firstHost)
        expect(dispatch.mock.calls[0]?.[1]).toEqual({ type: 'disconnect' })
    })

    it('detects connection of nodes inside open shadow roots via recheck', () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const outer = document.createElement('div')
        document.body.appendChild(outer)
        const shadow = outer.attachShadow({ mode: 'open' })
        const inner = document.createElement('span')
        const host = stubHost(inner)
        observer.asSink().track(host)
        shadow.appendChild(inner)
        // happy-dom delivers no MutationObserver records for mutations
        // inside shadow roots (spec-compliant browsers do); the explicit
        // recheck driver covers the compare path deterministically.
        observer.recheck(host)
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch.mock.calls[0]?.[0]).toBe(host)
        expect(dispatch.mock.calls[0]?.[1]).toEqual({ type: 'connect' })
    })

    it('keeps observing shadow hosts across light-DOM moves', async () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const outer = document.createElement('div')
        document.body.appendChild(outer)
        outer.attachShadow({ mode: 'open' })
        const host = stubHost(outer)
        observer.asSink().track(host)
        outer.remove()
        await flushMutations()
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch.mock.calls[0]?.[0]).toBe(host)
        expect(dispatch.mock.calls[0]?.[1]).toEqual({ type: 'disconnect' })
    })

    it('shares one per-document observer handle set without early teardown', async () => {
        const firstDispatch = vi.fn()
        const secondDispatch = vi.fn()
        const first = createObserver({ dispatch: firstDispatch })
        const second = createObserver({ dispatch: secondDispatch })
        disposers.push(() => first.dispose())
        disposers.push(() => second.dispose())
        const firstElement = document.createElement('div')
        const secondElement = document.createElement('p')
        first.asSink().track(stubHost(firstElement))
        second.asSink().track(stubHost(secondElement))
        document.body.appendChild(firstElement)
        document.body.appendChild(secondElement)
        await flushMutations()
        expect(firstDispatch).toHaveBeenCalledTimes(1)
        expect(secondDispatch).toHaveBeenCalledTimes(1)
        first.dispose()
        secondElement.remove()
        await flushMutations()
        expect(secondDispatch).toHaveBeenCalledTimes(2)
        expect(secondDispatch.mock.calls[1]?.[1]).toEqual({ type: 'disconnect' })
    })

    it('accepts an explicit document option', async () => {
        const dispatch = vi.fn()
        const observer = createObserver({ dispatch, document })
        disposers.push(() => observer.dispose())
        const element = document.createElement('div')
        document.body.appendChild(element)
        observer.asSink().track(stubHost(element))
        element.remove()
        await flushMutations()
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch.mock.calls[0]?.[1]).toEqual({ type: 'disconnect' })
    })

    it('tolerates hosts whose native() throws', () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const broken: HostPort = {
            token: null,
            get isConnected() {
                return false
            },
            parent: null,
            lifecycle$: EMPTY,
            on: () => () => {},
            native: (): unknown => {
                throw new Error('no-native')
            },
        }
        expect(() => observer.asSink().track(broken)).not.toThrow()
        expect(() => observer.recheck(broken)).not.toThrow()
        expect(dispatch).not.toHaveBeenCalled()
        expect(observer.size()).toBe(1)
        observer.asSink().untrack(broken)
        expect(observer.size()).toBe(0)
    })

    it('treats primitive natives as disconnected placeholders', () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const primitive: HostPort = {
            token: null,
            get isConnected() {
                return false
            },
            parent: null,
            lifecycle$: EMPTY,
            on: () => () => {},
            native: () => 42,
        }
        observer.asSink().track(primitive)
        observer.recheck(primitive)
        expect(dispatch).not.toHaveBeenCalled()
        expect(observer.size()).toBe(1)
    })

    it('adopts the owner document lazily for natives without one', () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        let current: unknown = { isConnected: true }
        const fluid: HostPort = {
            token: null,
            get isConnected() {
                return (current as Element).isConnected === true
            },
            parent: null,
            lifecycle$: EMPTY,
            on: () => () => {},
            native: () => current,
        }
        observer.asSink().track(fluid)
        const element = document.createElement('div')
        document.body.appendChild(element)
        current = element
        observer.recheck(fluid)
        expect(dispatch).not.toHaveBeenCalled()
        expect(observer.size()).toBe(1)
    })

    it('reports null keys when getAttribute throws', async () => {
        const onKeyChange = vi.fn()
        const observer = trackObserver(() => {}, onKeyChange)
        const element = document.createElement('div')
        document.body.appendChild(element)
        const host = stubHost(element, 'app:box')
        observer.asSink().track(host)
        const original = element.getAttribute.bind(element)
        element.getAttribute = (): never => {
            throw new Error('attr-denied')
        }
        try {
            element.setAttribute('data-context-key', 'app:other')
            await flushMutations()
            expect(onKeyChange).toHaveBeenCalledTimes(1)
            expect(onKeyChange.mock.calls[0]?.[0]).toBe(host)
            expect(onKeyChange.mock.calls[0]?.[1]).toBeNull()
        } finally {
            element.getAttribute = original
        }
    })

    it('ignores key mutations without a key-change hook', async () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const element = document.createElement('div')
        document.body.appendChild(element)
        observer.asSink().track(stubHost(element))
        element.setAttribute('data-context-key', 'app:ghost')
        await flushMutations()
        expect(dispatch).not.toHaveBeenCalled()
    })

    it('matches key changes to the owning host across tracked siblings', async () => {
        const onKeyChange = vi.fn()
        const observer = trackObserver(() => {}, onKeyChange)
        const first = document.createElement('div')
        const second = document.createElement('div')
        document.body.appendChild(first)
        document.body.appendChild(second)
        const firstHost = stubHost(first, 'app:first')
        observer.asSink().track(firstHost)
        observer.asSink().track(stubHost(second, 'app:second'))
        first.setAttribute('data-context-key', 'app:external')
        await flushMutations()
        expect(onKeyChange).toHaveBeenCalledTimes(1)
        expect(onKeyChange.mock.calls[0]?.[0]).toBe(firstHost)
        expect(onKeyChange.mock.calls[0]?.[1]).toBe('app:external')
    })

    it('dedupes synchronous observe() calls into one check', async () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const element = document.createElement('div')
        document.body.appendChild(element)
        const host = stubHost(element)
        observer.asSink().track(host)
        element.remove()
        observer.observe()
        observer.observe()
        await flushMutations()
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch.mock.calls[0]?.[1]).toEqual({ type: 'disconnect' })
    })

    it('drops checks scheduled before suspend or dispose', async () => {
        const dispatch = vi.fn()
        const first = trackObserver(dispatch)
        const element = document.createElement('div')
        document.body.appendChild(element)
        first.asSink().track(stubHost(element))
        first.observe()
        first.suspend()
        await flushMutations()
        expect(dispatch).not.toHaveBeenCalled()
        const secondDispatch = vi.fn()
        const second = createObserver({ dispatch: secondDispatch })
        const other = document.createElement('div')
        document.body.appendChild(other)
        second.asSink().track(stubHost(other))
        second.observe()
        second.dispose()
        disposers.push(() => second.dispose())
        other.remove()
        await flushMutations()
        expect(secondDispatch).not.toHaveBeenCalled()
    })

    it('ignores track, observe, recheck, and untrack after dispose', () => {
        const dispatch = vi.fn()
        const observer = createObserver({ dispatch })
        const element = document.createElement('div')
        document.body.appendChild(element)
        const host = stubHost(element)
        observer.dispose()
        observer.dispose()
        expect(() => {
            observer.asSink().track(host)
            observer.observe()
            observer.recheck(host)
            observer.asSink().untrack(host)
        }).not.toThrow()
        expect(dispatch).not.toHaveBeenCalled()
        expect(observer.size()).toBe(0)
    })

    it('dedupes repeat tracks of one host and tolerates unknown untracks', () => {
        const observer = trackObserver(() => {})
        const element = document.createElement('div')
        document.body.appendChild(element)
        const host = stubHost(element)
        observer.asSink().track(host)
        observer.asSink().track(host)
        expect(observer.size()).toBe(1)
        observer.asSink().untrack(stubHost(document.createElement('div')))
        expect(observer.size()).toBe(1)
        observer.asSink().untrack(host)
        expect(observer.size()).toBe(0)
    })

    it('skips inactive handles while live siblings still dispatch', async () => {
        const quiet = vi.fn()
        const loud = vi.fn()
        const first = createObserver({ dispatch: quiet })
        const second = createObserver({ dispatch: loud })
        disposers.push(() => first.dispose())
        disposers.push(() => second.dispose())
        const element = document.createElement('div')
        document.body.appendChild(element)
        first.asSink().track(stubHost(element))
        second.asSink().track(stubHost(element))
        first.suspend()
        element.remove()
        await flushMutations()
        expect(quiet).not.toHaveBeenCalled()
        expect(loud).toHaveBeenCalledTimes(1)
    })

    it('fires onStructureChange once per childList batch', async () => {
        const structure = vi.fn()
        const observer = trackObserver(() => {}, undefined, structure)
        const element = document.createElement('div')
        document.body.appendChild(element)
        observer.asSink().track(stubHost(element))
        const child = document.createElement('span')
        element.appendChild(child)
        element.appendChild(document.createElement('em'))
        await flushMutations()
        expect(structure).toHaveBeenCalledTimes(1)
    })

    it('fires onStructureChange on connection batches via recheck', () => {
        const structure = vi.fn()
        const observer = trackObserver(() => {}, undefined, structure)
        const element = document.createElement('div')
        document.body.appendChild(element)
        const host = stubHost(element)
        observer.asSink().track(host)
        element.remove()
        observer.recheck(host)
        expect(structure).toHaveBeenCalledTimes(1)
    })

    it('stays silent without an onStructureChange hook', async () => {
        const dispatch = vi.fn()
        const observer = trackObserver(dispatch)
        const element = document.createElement('div')
        document.body.appendChild(element)
        observer.asSink().track(stubHost(element))
        element.remove()
        await flushMutations()
        expect(dispatch).toHaveBeenCalledTimes(1)
    })
})
