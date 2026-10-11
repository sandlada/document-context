/**
 * Contract tests for the cross-tab storage sync transport.
 *
 * This suite runs under the `integration` project (happy-dom) so `window`
 * and the storage event machinery exist. `BroadcastChannel` is stubbed with
 * an in-memory bus for determinism; one case removes the stub to prove the
 * storage-event fallback stands alone.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    attachStorageEvent,
    channelNameFor,
    compareEnvelopes,
    createCrossTabSync,
    createTabId,
    decodeEnvelope,
    encodeEnvelope,
    getTabId,
    storageLockNameFor,
    withStorageLock,
} from './sync.js'
import type { StorageSyncEnvelope } from './sync.js'

/**
 * In-memory `BroadcastChannel` stand-in. Delivery is synchronous and
 * intentionally loops back to the sender (a superset of the platform, which
 * never redelivers to the posting object), so the self-echo filter is proven
 * rather than assumed.
 */
class FakeBroadcastChannel {
    static live = new Set<FakeBroadcastChannel>()
    onmessage: ((event: { readonly data: unknown }) => void) | null = null
    readonly name: string
    private disposed = false
    constructor(name: string) {
        this.name = name
        FakeBroadcastChannel.live.add(this)
    }
    postMessage(data: unknown): void {
        if (this.disposed) {
            return
        }
        for (const peer of Array.from(FakeBroadcastChannel.live)) {
            if (peer.name === this.name && peer.disposed === false) {
                peer.onmessage?.({ data })
            }
        }
    }
    close(): void {
        this.disposed = true
        FakeBroadcastChannel.live.delete(this)
    }
}

type MutableGlobals = {
    BroadcastChannel?: unknown
}

const readBroadcastChannel = (): unknown => (globalThis as unknown as MutableGlobals).BroadcastChannel

const writeBroadcastChannel = (value: unknown): void => {
    (globalThis as unknown as MutableGlobals).BroadcastChannel = value
}

/**
 * Stubs a global property through `defineProperty` (plain assignment fails on
 * getter-only globals such as `crypto` or `navigator.locks`).
 *
 * @param holder Object holding the property (`globalThis`, `navigator`).
 * @param key Property to replace.
 * @param value Replacement value.
 * @returns Restore function reinstalling the original descriptor.
 */
const stubGlobal = (holder: object, key: string, value: unknown): (() => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(holder, key)
    Object.defineProperty(holder, key, { value, configurable: true, writable: true })
    return () => {
        if (descriptor === undefined) {
            delete (holder as Record<string, unknown>)[key]
        } else {
            Object.defineProperty(holder, key, descriptor)
        }
    }
}

/**
 * Dispatches a `storage` event the way another tab's write would surface it.
 * Prefers the platform `StorageEvent` constructor and falls back to a plain
 * `Event` carrying the same fields.
 *
 * @param key Storage key carried by the event.
 * @param newValue New raw value, or null for a removal.
 */
function dispatchStorageEvent(key: string, newValue: string | null): void {
    let event: Event
    try {
        const Ctor = (
            window as unknown as {
                readonly StorageEvent?: new (type: string, init: { readonly key: string, readonly newValue: string | null }) => StorageEvent
            }
        ).StorageEvent
        event = typeof Ctor === 'function' ? new Ctor('storage', { key, newValue }) : plainStorageEvent(key, newValue)
    } catch {
        event = plainStorageEvent(key, newValue)
    }
    window.dispatchEvent(event)
}

/**
 * Builds a plain `Event` with `storage`-event fields for runtimes without a
 * usable `StorageEvent` constructor.
 *
 * @param key Storage key carried by the event.
 * @param newValue New raw value, or null for a removal.
 * @returns A dispatchable event carrying the key and value.
 */
function plainStorageEvent(key: string, newValue: string | null): Event {
    const event = new Event('storage')
    const record = event as unknown as Record<string, unknown>
    record['key'] = key
    record['newValue'] = newValue
    return event
}

/**
 * Builds a valid envelope with convenient overrides for ordering tests.
 *
 * @param overrides Partial fields replacing the defaults.
 * @returns A complete sync envelope.
 */
function makeEnvelope(overrides: Record<string, unknown> = {}): StorageSyncEnvelope {
    const envelope = {
        kind: 'write',
        key: 'app:key',
        v: 0,
        d: 'bytes',
        ts: 1000,
        tabId: 'tab-a',
        seq: 1,
        ...overrides,
    }
    return envelope as StorageSyncEnvelope
}

describe('createTabId', () => {
    it('returns a non-empty string identity', () => {
        expect(typeof createTabId()).toBe('string')
        expect(createTabId().length).toBeGreaterThan(0)
    })

    it('generates unique ids across calls', () => {
        const ids = new Set<string>()
        for (let index = 0; index < 50; index += 1) {
            ids.add(createTabId())
        }
        expect(ids.size).toBe(50)
    })

    it('falls back to the counter tag without randomUUID', () => {
        const restore = stubGlobal(globalThis, 'crypto', {})
        try {
            const first = createTabId()
            const second = createTabId()
            expect(first).toMatch(/^tab-/)
            expect(second).toMatch(/^tab-/)
            expect(first).not.toBe(second)
        } finally {
            restore()
        }
    })

    it('falls back when crypto access throws', () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
        Object.defineProperty(globalThis, 'crypto', {
            get(): never {
                throw new Error('denied')
            },
            configurable: true,
        })
        try {
            expect(createTabId()).toMatch(/^tab-/)
        } finally {
            if (descriptor === undefined) {
                delete (globalThis as unknown as Record<string, unknown>)['crypto']
            } else {
                Object.defineProperty(globalThis, 'crypto', descriptor)
            }
        }
    })
})

describe('getTabId', () => {
    it('returns a stable per-realm identity', () => {
        expect(getTabId()).toBe(getTabId())
        expect(getTabId().length).toBeGreaterThan(0)
    })
})

describe('channelNameFor / storageLockNameFor', () => {
    it('namespaces channels as dc-storage:<key>', () => {
        expect(channelNameFor('app:counter')).toBe('dc-storage:app%3Acounter')
    })

    it('namespaces locks as dc-storage:<key>', () => {
        expect(storageLockNameFor('app:counter')).toBe('dc-storage:app%3Acounter')
    })

    it('keeps distinct keys on distinct channels', () => {
        expect(channelNameFor('app:a')).not.toBe(channelNameFor('app:b'))
    })
})

describe('encodeEnvelope / decodeEnvelope', () => {
    it('round-trips an envelope through JSON', () => {
        const envelope = makeEnvelope({ d: '{"v":2,"d":{"count":3}}', v: 2 })
        const decoded = decodeEnvelope(encodeEnvelope(envelope))
        expect(decoded).toEqual(envelope)
    })

    it('returns null for malformed payloads instead of throwing', () => {
        expect(decodeEnvelope('')).toBeNull()
        expect(decodeEnvelope('not json')).toBeNull()
        expect(decodeEnvelope('[]')).toBeNull()
        expect(decodeEnvelope('{}')).toBeNull()
        expect(decodeEnvelope('null')).toBeNull()
        expect(decodeEnvelope(JSON.stringify(makeEnvelope({ kind: 'bogus' })))).toBeNull()
        expect(decodeEnvelope(JSON.stringify(makeEnvelope({ seq: 'one' })))).toBeNull()
    })

    it('rejects mistyped key, version, and data fields', () => {
        expect(decodeEnvelope(JSON.stringify(makeEnvelope({ key: 42 })))).toBeNull()
        expect(decodeEnvelope(JSON.stringify(makeEnvelope({ v: 'two' })))).toBeNull()
        expect(decodeEnvelope(JSON.stringify(makeEnvelope({ d: 42 })))).toBeNull()
        expect(decodeEnvelope(JSON.stringify(makeEnvelope({ ts: 'now', tabId: 7, seq: null })))).toBeNull()
        expect(decodeEnvelope(JSON.stringify(makeEnvelope({ d: null, kind: 'remove' })))).not.toBeNull()
    })
})

describe('compareEnvelopes', () => {
    it('orders by timestamp first', () => {
        const older = makeEnvelope({ ts: 1, seq: 99, tabId: 'tab-z' })
        const newer = makeEnvelope({ ts: 2, seq: 1, tabId: 'tab-a' })
        expect(compareEnvelopes(older, newer)).toBeLessThan(0)
        expect(compareEnvelopes(newer, older)).toBeGreaterThan(0)
    })

    it('breaks timestamp ties by sequence', () => {
        const first = makeEnvelope({ ts: 5, seq: 1 })
        const second = makeEnvelope({ ts: 5, seq: 2 })
        expect(compareEnvelopes(first, second)).toBeLessThan(0)
        expect(compareEnvelopes(second, first)).toBeGreaterThan(0)
    })

    it('breaks sequence ties by tabId for a total order', () => {
        const lower = makeEnvelope({ ts: 5, seq: 5, tabId: 'tab-a' })
        const higher = makeEnvelope({ ts: 5, seq: 5, tabId: 'tab-b' })
        expect(compareEnvelopes(lower, higher)).toBeLessThan(0)
        expect(compareEnvelopes(higher, lower)).toBeGreaterThan(0)
        expect(compareEnvelopes(lower, { ...lower })).toBe(0)
    })

    it('picks the last write for flush-then-compare consumers', () => {
        const local = makeEnvelope({ ts: 10, seq: 1, tabId: 'tab-a' })
        const remote = makeEnvelope({ ts: 11, seq: 1, tabId: 'tab-b' })
        const candidates = [local, remote].sort(compareEnvelopes)
        expect(candidates[candidates.length - 1]).toEqual(remote)
    })
})

describe('withStorageLock', () => {
    it('runs a synchronous task and returns its value', async () => {
        const result = await withStorageLock('app:key', () => 41)
        expect(result).toBe(41)
    })

    it('runs an asynchronous task and returns its value', async () => {
        const result = await withStorageLock('app:key', async () => 'locked')
        expect(result).toBe('locked')
    })

    it('serializes through Web Locks when present', async () => {
        const seen: Array<string> = []
        const restore = stubGlobal(navigator, 'locks', {
            request: async (name: string, _options: { readonly mode: string }, task: () => unknown): Promise<unknown> => {
                seen.push(name)
                return task()
            },
        })
        try {
            const result = await withStorageLock('app:key', () => 'under-lock')
            expect(result).toBe('under-lock')
            expect(seen).toEqual([storageLockNameFor('app:key')])
        } finally {
            restore()
        }
    })

    it('runs directly when locks are absent or malformed', async () => {
        const restoreNull = stubGlobal(navigator, 'locks', null)
        try {
            expect(await withStorageLock('app:key', () => 'direct-null')).toBe('direct-null')
        } finally {
            restoreNull()
        }
        const restoreShapeless = stubGlobal(navigator, 'locks', {})
        try {
            expect(await withStorageLock('app:key', () => 'direct-shapeless')).toBe('direct-shapeless')
        } finally {
            restoreShapeless()
        }
    })

    it('runs directly when locks access throws', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks')
        Object.defineProperty(navigator, 'locks', {
            get(): never {
                throw new Error('locks-denied')
            },
            configurable: true,
        })
        try {
            expect(await withStorageLock('app:key', () => 'direct-denied')).toBe('direct-denied')
        } finally {
            if (descriptor === undefined) {
                Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true, writable: true })
            } else {
                Object.defineProperty(navigator, 'locks', descriptor)
            }
        }
    })
})

describe('attachStorageEvent', () => {
    it('delivers matching-key events with the new value', () => {
        const seen: Array<string | null> = []
        const detach = attachStorageEvent('app:key', (value) => {
            seen.push(value)
        })
        dispatchStorageEvent('app:key', 'remote-bytes')
        expect(seen).toEqual(['remote-bytes'])
        detach()
    })

    it('delivers removals as null and ignores other keys', () => {
        const seen: Array<string | null> = []
        const detach = attachStorageEvent('app:key', (value) => {
            seen.push(value)
        })
        dispatchStorageEvent('app:other', 'ignored')
        dispatchStorageEvent('app:key', null)
        expect(seen).toEqual([null])
        detach()
    })

    it('stops delivering after detach (idempotent)', () => {
        const seen: Array<string | null> = []
        const detach = attachStorageEvent('app:key', (value) => {
            seen.push(value)
        })
        detach()
        detach()
        dispatchStorageEvent('app:key', 'late')
        expect(seen).toEqual([])
    })

    it('degrades to a no-op detach without window event support', () => {
        const win = window as unknown as Record<string, unknown>
        const previous = win['addEventListener']
        try {
            win['addEventListener'] = 42
            const detach = attachStorageEvent('app:key', () => {
                throw new Error('must never deliver')
            })
            expect(() => detach()).not.toThrow()
        } finally {
            win['addEventListener'] = previous
        }
    })

    it('tolerates a throwing removeEventListener on detach', () => {
        const win = window as unknown as Record<string, unknown>
        const previous = win['removeEventListener']
        try {
            const seen: Array<string | null> = []
            const detach = attachStorageEvent('app:key', (value) => {
                seen.push(value)
            })
            win['removeEventListener'] = (): void => {
                throw new Error('remove-broken')
            }
            expect(() => detach()).not.toThrow()
            expect(seen).toEqual([])
        } finally {
            win['removeEventListener'] = previous
        }
    })
})

describe('createCrossTabSync', () => {
    let previous: unknown

    beforeEach(() => {
        FakeBroadcastChannel.live.clear()
        previous = readBroadcastChannel()
        writeBroadcastChannel(FakeBroadcastChannel)
    })

    afterEach(() => {
        writeBroadcastChannel(previous)
        FakeBroadcastChannel.live.clear()
    })

    it('delivers broadcasts to sibling handles but never refluxes the sender', () => {
        const seenA: Array<string | null> = []
        const seenB: Array<string | null> = []
        const handleA = createCrossTabSync({ key: 'app:key', tabId: 'tab-a', onRemote: (value) => { seenA.push(value) } })
        const handleB = createCrossTabSync({ key: 'app:key', tabId: 'tab-b', onRemote: (value) => { seenB.push(value) } })
        handleA.send('hello')
        expect(seenB).toEqual(['hello'])
        expect(seenA).toEqual([])
        handleA.close()
        handleB.close()
    })

    it('delivers same-tab sibling writes while dropping own sequences', () => {
        const seenA: Array<string | null> = []
        const seenB: Array<string | null> = []
        const handleA = createCrossTabSync({ key: 'app:key', tabId: 'tab-same', onRemote: (value) => { seenA.push(value) } })
        const handleB = createCrossTabSync({ key: 'app:key', tabId: 'tab-same', onRemote: (value) => { seenB.push(value) } })
        handleA.send('sibling-bytes')
        expect(seenB).toEqual(['sibling-bytes'])
        expect(seenA).toEqual([])
        handleA.close()
        handleB.close()
    })

    it('drops byte-equal duplicates while letting new bytes through', () => {
        const seen: Array<string | null> = []
        const sender = createCrossTabSync({ key: 'app:key', tabId: 'tab-a', onRemote: () => {} })
        const receiver = createCrossTabSync({ key: 'app:key', tabId: 'tab-b', onRemote: (value) => { seen.push(value) } })
        sender.send('same-bytes')
        sender.send('same-bytes')
        expect(seen).toEqual(['same-bytes'])
        sender.send('new-bytes')
        expect(seen).toEqual(['same-bytes', 'new-bytes'])
        sender.close()
        receiver.close()
    })

    it('drops replayed (tabId, seq) pairs carrying different bytes', () => {
        const seen: Array<string | null> = []
        const receiver = createCrossTabSync({ key: 'app:key', tabId: 'tab-b', onRemote: (value) => { seen.push(value) } })
        const channel = Array.from(FakeBroadcastChannel.live).find((peer) => peer.name === channelNameFor('app:key'))
        expect(channel).toBeDefined()
        const first = encodeEnvelope(makeEnvelope({ key: 'app:key', tabId: 'tab-a', seq: 7, d: 'one' }))
        const replay = encodeEnvelope(makeEnvelope({ key: 'app:key', tabId: 'tab-a', seq: 7, d: 'two' }))
        channel?.onmessage?.({ data: first })
        channel?.onmessage?.({ data: replay })
        expect(seen).toEqual(['one'])
        receiver.close()
    })

    it('ignores non-string data, malformed envelopes, and foreign keys', () => {
        const seen: Array<string | null> = []
        const receiver = createCrossTabSync({ key: 'app:key', tabId: 'tab-b', onRemote: (value) => { seen.push(value) } })
        const channel = Array.from(FakeBroadcastChannel.live).find((peer) => peer.name === channelNameFor('app:key'))
        channel?.onmessage?.({ data: 42 })
        channel?.onmessage?.({ data: 'garbage' })
        channel?.onmessage?.({ data: encodeEnvelope(makeEnvelope({ key: 'app:other' })) })
        expect(seen).toEqual([])
        receiver.close()
    })

    it('exposes the tab identity and channel name', () => {
        const handle = createCrossTabSync({ key: 'app:key', tabId: 'tab-mine', onRemote: () => {} })
        expect(handle.tabId).toBe('tab-mine')
        expect(handle.channelName).toBe(channelNameFor('app:key'))
        handle.close()
    })

    it('sends removals as null with kind remove', () => {
        const seen: Array<{ readonly value: string | null, readonly envelope: StorageSyncEnvelope }> = []
        const sender = createCrossTabSync({ key: 'app:key', tabId: 'tab-a', onRemote: () => {} })
        const receiver = createCrossTabSync({
            key: 'app:key',
            tabId: 'tab-b',
            onRemote: (value, envelope) => { seen.push({ value, envelope }) },
        })
        sender.send(null)
        expect(seen.length).toBe(1)
        expect(seen[0]?.value).toBeNull()
        expect(seen[0]?.envelope.kind).toBe('remove')
        expect(seen[0]?.envelope.d).toBeNull()
        sender.close()
        receiver.close()
    })

    it('falls back to storage events when BroadcastChannel is absent', () => {
        writeBroadcastChannel(undefined)
        const seen: Array<string | null> = []
        const handle = createCrossTabSync({ key: 'app:key', onRemote: (value) => { seen.push(value) } })
        dispatchStorageEvent('app:key', 'fallback-bytes')
        expect(seen).toEqual(['fallback-bytes'])
        expect(() => handle.send('local-write')).not.toThrow()
        handle.close()
    })

    it('close() is idempotent and silences every path', () => {
        const seen: Array<string | null> = []
        const handle = createCrossTabSync({ key: 'app:key', tabId: 'tab-a', onRemote: (value) => { seen.push(value) } })
        handle.close()
        handle.close()
        expect(() => handle.send('after-close')).not.toThrow()
        dispatchStorageEvent('app:key', 'after-close')
        const channel = Array.from(FakeBroadcastChannel.live).find((peer) => peer.name === channelNameFor('app:key'))
        expect(channel).toBeUndefined()
        expect(seen).toEqual([])
    })

    it('stamps versioned payloads and bounds the own-sequence memory', () => {
        const seen: Array<{ readonly value: string | null, readonly envelope: StorageSyncEnvelope }> = []
        const sender = createCrossTabSync({ key: 'app:key', tabId: 'tab-a', onRemote: () => {} })
        const receiver = createCrossTabSync({
            key: 'app:key',
            tabId: 'tab-b',
            onRemote: (value, envelope) => { seen.push({ value, envelope }) },
        })
        sender.send(JSON.stringify({ v: 7, d: { count: 1 } }))
        expect(seen[0]?.envelope.v).toBe(7)
        sender.send('5')
        sender.send('plain-bytes')
        expect(seen.map((entry) => entry.envelope.v)).toEqual([7, 0, 0])
        for (let index = 0; index < 140; index += 1) {
            sender.send(`bulk-${index}`)
        }
        expect(seen.length).toBeGreaterThan(130)
        sender.close()
        receiver.close()
    })

    it('bounds the seen-set and redelivers evicted pairs', () => {
        const seen: Array<string | null> = []
        const receiver = createCrossTabSync({ key: 'app:key', tabId: 'tab-b', onRemote: (value) => { seen.push(value) } })
        const channel = Array.from(FakeBroadcastChannel.live).find((peer) => peer.name === channelNameFor('app:key'))
        expect(channel).toBeDefined()
        const first = encodeEnvelope(makeEnvelope({ key: 'app:key', tabId: 'tab-a', seq: 1, d: 'one' }))
        channel?.onmessage?.({ data: first })
        for (let seq = 2; seq <= 140; seq += 1) {
            channel?.onmessage?.({ data: encodeEnvelope(makeEnvelope({ key: 'app:key', tabId: 'tab-a', seq, d: `v${seq}` })) })
        }
        const before = seen.length
        channel?.onmessage?.({ data: first })
        expect(seen.length).toBe(before + 1)
        expect(seen[seen.length - 1]).toBe('one')
        receiver.close()
    })

    it('tolerates a throwing BroadcastChannel constructor', () => {
        writeBroadcastChannel(class {
            constructor(_name: string) {
                throw new Error('channel-denied')
            }
        })
        const seen: Array<string | null> = []
        const handle = createCrossTabSync({ key: 'app:key', onRemote: (value) => { seen.push(value) } })
        expect(() => handle.send('local-only')).not.toThrow()
        dispatchStorageEvent('app:key', 'fallback-bytes')
        expect(seen).toEqual(['fallback-bytes'])
        handle.close()
    })

    it('tolerates a throwing postMessage broadcast', () => {
        writeBroadcastChannel(class {
            onmessage: ((event: { readonly data: unknown }) => void) | null = null
            readonly name: string
            constructor(name: string) {
                this.name = name
            }
            postMessage(_data: unknown): void {
                throw new Error('post-denied')
            }
            close(): void {}
        })
        const handle = createCrossTabSync({ key: 'app:key', onRemote: () => {} })
        expect(() => handle.send('best-effort')).not.toThrow()
        handle.close()
    })
})
