/**
 * W3C Context Protocol scope-transport tests: synchronous request snapshots
 * over real bubbling events, nearest-wins single resolution, ordered multi
 * snapshots, and cold stays-open watch channels with wake-up retries.
 *
 * Runs in happy-dom. Responders are plain `context-request` listeners that
 * answer through `detail.callback` without reading `event.target`, mirroring
 * the application-layer responder contract.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY, type Observable } from 'rxjs'
import { definePrivateToken } from '../../domain/model/token.js'
import type { Token } from '../../domain/model/token.js'
import { DocumentContextError } from '../../domain/model/errors.js'
import type { HostPort } from '../../domain/ports/host.js'
import type { ScopeResolution } from '../../domain/ports/scope-transport.js'
import { createHostAdapter } from './host-adapter.js'
import { CONTEXT_REQUEST_EVENT, createScopeTransport } from './scope-transport.js'
import type { ContextRequestDetail, PendingWake } from './scope-transport.js'

afterEach(() => {
    document.body.innerHTML = ''
})

const buildChain = (): { readonly root: HTMLDivElement, readonly middle: HTMLDivElement, readonly leaf: HTMLSpanElement } => {
    const root = document.createElement('div')
    const middle = document.createElement('div')
    const leaf = document.createElement('span')
    middle.appendChild(leaf)
    root.appendChild(middle)
    document.body.appendChild(root)
    return { root, middle, leaf }
}

/** Test responder answering one token; single answers stop propagation. */
const answer = (node: Element, token: Token, value: unknown): { readonly calls: () => number, readonly dispose: () => void } => {
    let calls = 0
    const listener = (event: Event): void => {
        const request = event as CustomEvent<ContextRequestDetail>
        if (request.detail.token !== token) {
            return
        }
        calls += 1
        request.detail.callback(value, () => {})
        if (request.detail.multi !== true) {
            request.stopPropagation()
        }
    }
    node.addEventListener(CONTEXT_REQUEST_EVENT, listener)
    return {
        calls: () => calls,
        dispose: () => {
            node.removeEventListener(CONTEXT_REQUEST_EVENT, listener)
        },
    }
}

interface WakeRecord {
    readonly token: Token
    readonly host: HostPort
    readonly retry: () => void
    removed: boolean
}

const createWakeStub = (): {
    readonly entries: Array<WakeRecord>,
    readonly wake: PendingWake,
    readonly live: () => Array<WakeRecord>,
    readonly fire: (token: Token) => void,
} => {
    const entries: Array<WakeRecord> = []
    return {
        entries,
        wake: {
            add(entry: { readonly token: Token, readonly host: HostPort, readonly retry: () => void }): () => void {
                const record: WakeRecord = { token: entry.token, host: entry.host, retry: entry.retry, removed: false }
                entries.push(record)
                return () => {
                    record.removed = true
                }
            },
        },
        live: () => entries.filter((entry) => !entry.removed),
        fire: (token: Token): void => {
            for (const entry of [...entries]) {
                if (!entry.removed && entry.token === token) {
                    entry.retry()
                }
            }
        },
    }
}

const collect = <T>(observable: Observable<T>): {
    readonly values: Array<T>,
    readonly completed: () => boolean,
    readonly unsubscribe: () => void,
} => {
    const values: Array<T> = []
    let done = false
    const subscription = observable.subscribe({
        next: (value) => {
            values.push(value)
        },
        complete: () => {
            done = true
        },
    })
    return {
        values,
        completed: () => done,
        unsubscribe: () => {
            subscription.unsubscribe()
        },
    }
}

describe('event wire', () => {
    it('dispatches a bubbling, composed, cancelable event carrying the token', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        const seen: Array<{ readonly bubbles: boolean, readonly composed: boolean, readonly cancelable: boolean, readonly detail: ContextRequestDetail }> = []
        middle.addEventListener(CONTEXT_REQUEST_EVENT, (event) => {
            const request = event as CustomEvent<ContextRequestDetail>
            seen.push({ bubbles: event.bubbles, composed: event.composed, cancelable: event.cancelable, detail: request.detail })
            request.detail.callback('hit', () => {})
        })
        const hit = adapter.scopeTransport.request<string>('app:theme', adapter.toHost(leaf))
        expect(hit?.value).toBe('hit')
        expect(seen).toHaveLength(1)
        const first = seen[0]
        expect(first?.bubbles).toBe(true)
        expect(first?.composed).toBe(true)
        expect(first?.cancelable).toBe(true)
        expect(first?.detail.token).toBe('app:theme')
        expect(first?.detail.multi).toBe(false)
        hit?.unsubscribe()
    })

    it('passes the subscribe flag through to the responder detail', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        const flags: Array<boolean | undefined> = []
        middle.addEventListener(CONTEXT_REQUEST_EVENT, (event) => {
            const request = event as CustomEvent<ContextRequestDetail>
            flags.push(request.detail.subscribe)
            request.detail.callback('hit', () => {})
        })
        const leafHost = adapter.toHost(leaf)
        adapter.scopeTransport.request<string>('app:theme', leafHost)
        adapter.scopeTransport.request<string>('app:theme', leafHost, { subscribe: true })
        expect(flags).toEqual([undefined, true])
    })

    it('matches private tokens by reference through the detail', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        const first = definePrivateToken<string>('app:secret')
        const second = definePrivateToken<string>('app:secret')
        answer(middle, second, 'second-value')
        const leafHost = adapter.toHost(leaf)
        expect(adapter.scopeTransport.request<string>(first, leafHost)).toBeNull()
        expect(adapter.scopeTransport.request<string>(second, leafHost)?.value).toBe('second-value')
    })
})

describe('request (single nearest-wins)', () => {
    it('returns null on a miss without waiting', () => {
        const adapter = createHostAdapter()
        const { leaf } = buildChain()
        expect(adapter.scopeTransport.request('app:missing', adapter.toHost(leaf))).toBeNull()
    })

    it('returns the nearest hit and stops at the first responder', () => {
        const adapter = createHostAdapter()
        const { root, middle, leaf } = buildChain()
        const outer = answer(root, 'app:theme', 'root-theme')
        answer(middle, 'app:theme', 'middle-theme')
        const hit = adapter.scopeTransport.request<string>('app:theme', adapter.toHost(leaf))
        expect(hit?.value).toBe('middle-theme')
        expect(outer.calls()).toBe(0)
        hit?.unsubscribe()
    })

    it('wraps responder unsubscribes exactly once', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        let releases = 0
        middle.addEventListener(CONTEXT_REQUEST_EVENT, (event) => {
            const request = event as CustomEvent<ContextRequestDetail>
            if (request.detail.token !== 'app:theme') {
                return
            }
            request.detail.callback('hit', () => {
                releases += 1
            })
        })
        const hit = adapter.scopeTransport.request<string>('app:theme', adapter.toHost(leaf))
        hit?.unsubscribe()
        hit?.unsubscribe()
        expect(releases).toBe(1)
    })

    it('throws HOST_INVALID when the native node cannot dispatch', () => {
        const transport = createScopeTransport()
        const broken: HostPort = {
            token: null,
            isConnected: true,
            parent: null,
            lifecycle$: EMPTY,
            on: () => () => {},
            native: () => ({}),
        }
        let error: unknown = null
        try {
            transport.request('app:theme', broken)
        } catch (caught: unknown) {
            error = caught
        }
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('HOST_INVALID')
    })

    it('throws HOST_INVALID for null and primitive natives', () => {
        const transport = createScopeTransport()
        for (const native of [null, undefined, 42]) {
            const host: HostPort = {
                token: null,
                isConnected: true,
                parent: null,
                lifecycle$: EMPTY,
                on: () => () => {},
                native: () => native,
            }
            let error: unknown = null
            try {
                transport.request('app:theme', host)
            } catch (caught: unknown) {
                error = caught
            }
            expect(error).toBeInstanceOf(DocumentContextError)
            expect((error as DocumentContextError).code).toBe('HOST_INVALID')
        }
    })

    it('releases resolutions without a responder unsubscribe', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        middle.addEventListener(CONTEXT_REQUEST_EVENT, (event) => {
            const request = event as CustomEvent<ContextRequestDetail>
            if (request.detail.token !== 'app:bare') {
                return
            }
            request.detail.callback('bare-value')
        })
        const hit = adapter.scopeTransport.request<string>('app:bare', adapter.toHost(leaf))
        expect(hit?.value).toBe('bare-value')
        expect(() => hit?.unsubscribe()).not.toThrow()
    })

    it('omits the subscribe flag for explicit false', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        const flags: Array<boolean | undefined> = []
        middle.addEventListener(CONTEXT_REQUEST_EVENT, (event) => {
            const request = event as CustomEvent<ContextRequestDetail>
            flags.push(request.detail.subscribe)
            request.detail.callback('hit', () => {})
        })
        adapter.scopeTransport.request<string>('app:theme', adapter.toHost(leaf), { subscribe: false })
        expect(flags).toEqual([false])
    })
})

describe('requestAll (multi snapshots)', () => {
    it('returns an empty snapshot on a miss', () => {
        const adapter = createHostAdapter()
        const { leaf } = buildChain()
        expect(adapter.scopeTransport.requestAll('app:missing', adapter.toHost(leaf))).toEqual([])
    })

    it('collects every responder bottomUp (nearest-first) by default', () => {
        const adapter = createHostAdapter()
        const { root, middle, leaf } = buildChain()
        answer(root, 'app:tag', 'root-tag')
        answer(middle, 'app:tag', 'middle-tag')
        const bottomUp = adapter.scopeTransport.requestAll<string>('app:tag', adapter.toHost(leaf))
        expect(bottomUp.map((resolution) => resolution.value)).toEqual(['middle-tag', 'root-tag'])
    })

    it('reverses to outermost-first for topDown', () => {
        const adapter = createHostAdapter()
        const { root, middle, leaf } = buildChain()
        answer(root, 'app:tag', 'root-tag')
        answer(middle, 'app:tag', 'middle-tag')
        const topDown = adapter.scopeTransport.requestAll<string>('app:tag', adapter.toHost(leaf), { direction: 'topDown' })
        expect(topDown.map((resolution) => resolution.value)).toEqual(['root-tag', 'middle-tag'])
    })

    it('preserves same-host registration order under bottomUp', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        answer(middle, 'app:tag', 'first')
        answer(middle, 'app:tag', 'second')
        const hits = adapter.scopeTransport.requestAll<string>('app:tag', adapter.toHost(leaf))
        expect(hits.map((resolution) => resolution.value)).toEqual(['first', 'second'])
    })

    it('marks multi details so responders can skip stopPropagation', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        const flags: Array<boolean | undefined> = []
        middle.addEventListener(CONTEXT_REQUEST_EVENT, (event) => {
            const request = event as CustomEvent<ContextRequestDetail>
            flags.push(request.detail.multi)
            request.detail.callback('hit', () => {})
        })
        adapter.scopeTransport.requestAll<string>('app:tag', adapter.toHost(leaf))
        expect(flags).toEqual([true])
    })
})

describe('composed dispatch', () => {
    it('reaches responders outside an open shadow root', () => {
        const adapter = createHostAdapter()
        const outer = document.createElement('div')
        document.body.appendChild(outer)
        const shadow = outer.attachShadow({ mode: 'open' })
        const inner = document.createElement('span')
        shadow.appendChild(inner)
        answer(outer, 'app:theme', 'outer-theme')
        expect(adapter.scopeTransport.request<string>('app:theme', adapter.toHost(inner))?.value).toBe('outer-theme')
    })
})

describe('watch (cold stays-open single channel)', () => {
    it('dispatches nothing before subscribe and emits the hit on subscribe', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        const responder = answer(middle, 'app:late', 'late-value')
        const transport = createScopeTransport()
        const stream = transport.watch<string>('app:late', adapter.toHost(leaf))
        expect(responder.calls()).toBe(0)
        const collected = collect(stream)
        expect(responder.calls()).toBe(1)
        expect(collected.values.map((resolution) => resolution.value)).toEqual(['late-value'])
        expect(collected.completed()).toBe(false)
        collected.unsubscribe()
    })

    it('stays pending on a miss and emits on wake retries without completing', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        const stub = createWakeStub()
        const transport = createScopeTransport({ wake: stub.wake })
        const leafHost = adapter.toHost(leaf)
        const collected = collect(transport.watch<string>('app:late', leafHost))
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(false)
        expect(stub.live()).toHaveLength(1)
        expect(stub.entries[0]?.token).toBe('app:late')
        expect(stub.entries[0]?.host).toBe(leafHost)
        answer(middle, 'app:late', 'woken')
        stub.fire('app:late')
        stub.fire('app:other')
        expect(collected.values.map((resolution) => resolution.value)).toEqual(['woken'])
        expect(collected.completed()).toBe(false)
        collected.unsubscribe()
    })

    it('drops the wake entry on unsubscribe', () => {
        const adapter = createHostAdapter()
        const { leaf } = buildChain()
        const stub = createWakeStub()
        const transport = createScopeTransport({ wake: stub.wake })
        const collected = collect(transport.watch<string>('app:gone', adapter.toHost(leaf)))
        expect(stub.live()).toHaveLength(1)
        collected.unsubscribe()
        expect(stub.live()).toHaveLength(0)
        stub.fire('app:gone')
        expect(collected.values).toEqual([])
    })

    it('completes on abort and drops the wake entry', () => {
        const adapter = createHostAdapter()
        const { leaf } = buildChain()
        const stub = createWakeStub()
        const transport = createScopeTransport({ wake: stub.wake })
        const controller = new AbortController()
        const collected = collect(transport.watch<string>('app:abort', adapter.toHost(leaf), { signal: controller.signal }))
        expect(stub.live()).toHaveLength(1)
        controller.abort()
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(true)
        expect(stub.live()).toHaveLength(0)
    })

    it('completes immediately when the signal is already aborted', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        const responder = answer(middle, 'app:abort', 'too-late')
        const transport = createScopeTransport()
        const collected = collect(transport.watch<string>('app:abort', adapter.toHost(leaf), { signal: AbortSignal.abort() }))
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(true)
        expect(responder.calls()).toBe(0)
    })

    it('ignores wake retries after unsubscribe', () => {
        const adapter = createHostAdapter()
        const { leaf } = buildChain()
        const stub = createWakeStub()
        const transport = createScopeTransport({ wake: stub.wake })
        const collected = collect(transport.watch<string>('app:gone', adapter.toHost(leaf)))
        collected.unsubscribe()
        stub.fire('app:gone')
        expect(collected.values).toEqual([])
    })

    it('ignores direct retries after unsubscribe', () => {
        const adapter = createHostAdapter()
        const { leaf } = buildChain()
        const stub = createWakeStub()
        const transport = createScopeTransport({ wake: stub.wake })
        const collected = collect(transport.watch<string>('app:gone', adapter.toHost(leaf)))
        const entry = stub.entries[0]
        expect(entry).toBeDefined()
        collected.unsubscribe()
        entry?.retry()
        expect(collected.values).toEqual([])
    })

    it('ignores aborts after unsubscribe', () => {
        const adapter = createHostAdapter()
        const { leaf } = buildChain()
        const controller = new AbortController()
        const transport = createScopeTransport()
        const collected = collect(transport.watch<string>('app:x', adapter.toHost(leaf), { signal: controller.signal }))
        collected.unsubscribe()
        controller.abort()
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(false)
    })
})

describe('watchAll (cold stays-open multi channel)', () => {
    it('emits the empty snapshot on a miss and the hits on wake retries', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        const stub = createWakeStub()
        const transport = createScopeTransport({ wake: stub.wake })
        const collected = collect(transport.watchAll<string>('app:tags', adapter.toHost(leaf)))
        expect(collected.values).toHaveLength(1)
        expect(collected.values[0]).toEqual([])
        expect(collected.completed()).toBe(false)
        answer(middle, 'app:tags', 'first')
        stub.fire('app:tags')
        expect(collected.values).toHaveLength(2)
        const second = collected.values[1]
        expect(second?.map((resolution: ScopeResolution<string>) => resolution.value)).toEqual(['first'])
        expect(collected.completed()).toBe(false)
        collected.unsubscribe()
        expect(stub.live()).toHaveLength(0)
    })

    it('honours the topDown direction on every emission', () => {
        const adapter = createHostAdapter()
        const { root, middle, leaf } = buildChain()
        answer(root, 'app:tag', 'root-tag')
        answer(middle, 'app:tag', 'middle-tag')
        const transport = createScopeTransport()
        const collected = collect(transport.watchAll<string>('app:tag', adapter.toHost(leaf), { direction: 'topDown' }))
        expect(collected.values).toHaveLength(1)
        const only = collected.values[0]
        expect(only?.map((resolution: ScopeResolution<string>) => resolution.value)).toEqual(['root-tag', 'middle-tag'])
        collected.unsubscribe()
    })

    it('completes on abort without emitting further', () => {
        const adapter = createHostAdapter()
        const { leaf } = buildChain()
        const transport = createScopeTransport()
        const controller = new AbortController()
        const collected = collect(transport.watchAll<string>('app:tags', adapter.toHost(leaf), { signal: controller.signal }))
        expect(collected.values).toHaveLength(1)
        controller.abort()
        expect(collected.completed()).toBe(true)
        collected.unsubscribe()
    })

    it('completes immediately when the signal is already aborted', () => {
        const adapter = createHostAdapter()
        const { middle, leaf } = buildChain()
        const responder = answer(middle, 'app:abort-all', 'too-late')
        const transport = createScopeTransport()
        const collected = collect(transport.watchAll<string>('app:abort-all', adapter.toHost(leaf), { signal: AbortSignal.abort() }))
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(true)
        expect(responder.calls()).toBe(0)
    })

    it('completes on abort and drops the wake entry', () => {
        const adapter = createHostAdapter()
        const { leaf } = buildChain()
        const stub = createWakeStub()
        const transport = createScopeTransport({ wake: stub.wake })
        const controller = new AbortController()
        const collected = collect(transport.watchAll<string>('app:abort-all', adapter.toHost(leaf), { signal: controller.signal }))
        expect(stub.live()).toHaveLength(1)
        controller.abort()
        expect(collected.completed()).toBe(true)
        expect(stub.live()).toHaveLength(0)
    })

    it('ignores wake retries and aborts after unsubscribe', () => {
        const adapter = createHostAdapter()
        const { leaf } = buildChain()
        const stub = createWakeStub()
        const transport = createScopeTransport({ wake: stub.wake })
        const controller = new AbortController()
        const collected = collect(transport.watchAll<string>('app:tags', adapter.toHost(leaf), { signal: controller.signal }))
        expect(collected.values).toHaveLength(1)
        const entry = stub.entries[0]
        expect(entry).toBeDefined()
        collected.unsubscribe()
        entry?.retry()
        stub.fire('app:tags')
        controller.abort()
        expect(collected.values).toHaveLength(1)
        expect(collected.completed()).toBe(false)
    })
})
