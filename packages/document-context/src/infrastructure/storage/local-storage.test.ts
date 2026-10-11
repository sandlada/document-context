/**
 * Tests for the `localStorage`-backed `StoragePort`, including the shared
 * `StoragePort` contract suite and the storage registry composed in
 * `./index.js`.
 *
 * `BroadcastChannel` is stubbed with a recording no-op so the suite stays
 * deterministic; the live channel behavior is proven in `sync.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { storagePortContract } from '../../domain/ports/storage.test.js'
import type { FakeStorageHandle } from '../../domain/ports/storage.test.js'
import type { StorageError } from '../../domain/ports/storage.js'
import { createStorageAdapters } from './index.js'
import { createLocalStorageAdapter } from './local-storage.js'
import { channelNameFor, decodeEnvelope } from './sync.js'

/**
 * Recording `BroadcastChannel` stand-in: captures posts without delivering,
 * so cross-tab timing can never leak between tests.
 */
class NoopBroadcastChannel {
    static posted: Array<{ readonly name: string, readonly data: unknown }> = []
    onmessage: ((event: { readonly data: unknown }) => void) | null = null
    readonly name: string
    constructor(name: string) {
        this.name = name
    }
    postMessage(data: unknown): void {
        NoopBroadcastChannel.posted.push({ name: this.name, data })
    }
    close(): void {}
}

/**
 * Map-backed `Storage` with an arming seam: the next operation throws the
 * armed value exactly once, then behaves normally.
 */
class ArmedBackend implements Storage {
    private data = new Map<string, string>()
    private armed: unknown = null
    get length(): number {
        return this.data.size
    }
    clear(): void {
        this.data.clear()
    }
    getItem(key: string): string | null {
        this.throwArmed()
        return this.data.get(key) ?? null
    }
    key(index: number): string | null {
        return Array.from(this.data.keys())[index] ?? null
    }
    removeItem(key: string): void {
        this.throwArmed()
        this.data.delete(key)
    }
    setItem(key: string, value: string): void {
        this.throwArmed()
        this.data.set(key, String(value))
    }
    /**
     * Arms a one-shot failure thrown by the next operation.
     *
     * @param error Value thrown once by the next backend call.
     */
    arm(error: unknown): void {
        this.armed = error
    }
    /**
     * Writes without consulting the armed failure, simulating bytes that
     * arrived from another tab.
     *
     * @param key Storage key.
     * @param value New bytes, or null for a removal.
     */
    writeRaw(key: string, value: string | null): void {
        if (value === null) {
            this.data.delete(key)
        } else {
            this.data.set(key, value)
        }
    }
    private throwArmed(): void {
        const failure = this.armed
        this.armed = null
        if (failure !== null) {
            throw failure
        }
    }
}

/**
 * Dispatches a `storage` event the way another tab's write would surface it.
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
        if (typeof Ctor === 'function') {
            event = new Ctor('storage', { key, newValue })
        } else {
            event = plainStorageEvent(key, newValue)
        }
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

const readBroadcastChannel = (): unknown => (globalThis as unknown as { readonly BroadcastChannel?: unknown }).BroadcastChannel

const writeBroadcastChannel = (value: unknown): void => {
    const globals = globalThis as unknown as Record<string, unknown>
    globals['BroadcastChannel'] = value
}

/**
 * Installs a `Storage` backend on `window` for backends the runtime does not
 * provide (happy-dom may omit `localStorage`), proving adapters resolve the
 * backend lazily per operation.
 *
 * @param kind Which backend slot to install.
 * @param backend Backend exposed on `window` until restored.
 * @returns Restore function removing the installation.
 */
const installWindowBackend = (kind: 'localStorage' | 'sessionStorage', backend: Storage): (() => void) => {
    const win = window as unknown as Record<string, unknown>
    const hadOwn = Object.prototype.hasOwnProperty.call(window, kind)
    const previous = win[kind]
    Object.defineProperty(window, kind, { value: backend, writable: true, configurable: true, enumerable: true })
    return () => {
        if (hadOwn) {
            Object.defineProperty(window, kind, { value: previous, writable: true, configurable: true, enumerable: true })
        } else {
            delete win[kind]
        }
    }
}

const createHandle = (): FakeStorageHandle => {
    const backend = new ArmedBackend()
    const port = createLocalStorageAdapter({ backend })
    openHandles.push(port)
    return {
        port,
        emitExternal(key: string, value: string | null): void {
            backend.writeRaw(key, value)
            dispatchStorageEvent(key, value)
        },
        failNext(kind: StorageError['kind']): void {
            if (kind === 'unavailable') {
                backend.arm({ kind: 'unavailable' })
            } else if (kind === 'corrupt') {
                backend.arm({ kind: 'corrupt', raw: '<garbage' })
            } else if (kind === 'quota') {
                backend.arm({ name: 'QuotaExceededError', code: 22 })
            } else {
                backend.arm({ kind: 'unknown', cause: 'boom' })
            }
        },
    }
}

const openHandles: Array<{ close(): void }> = []
let previousBroadcastChannel: unknown

beforeEach(() => {
    NoopBroadcastChannel.posted.length = 0
    previousBroadcastChannel = readBroadcastChannel()
    writeBroadcastChannel(NoopBroadcastChannel)
})

afterEach(() => {
    writeBroadcastChannel(previousBroadcastChannel)
    for (const handle of openHandles.splice(0)) {
        try {
            handle.close()
        } catch {
            // Handles are already closed or closing; cleanup stays best-effort.
        }
    }
})

describe('localStorage adapter', () => {
    storagePortContract(createHandle)

    it('reports unavailable when no backend exists, never throwing', () => {
        const port = createLocalStorageAdapter({ backend: null })
        openHandles.push(port)
        expect(port.read('app:key')).toEqual({ ok: false, error: { kind: 'unavailable' } })
        expect(port.write('app:key', 'x')).toEqual({ ok: false, error: { kind: 'unavailable' } })
        expect(port.remove('app:key')).toEqual({ ok: false, error: { kind: 'unavailable' } })
        expect(NoopBroadcastChannel.posted).toEqual([])
    })

    it('rejects non-string writes as corrupt without touching storage', () => {
        const backend = new ArmedBackend()
        const port = createLocalStorageAdapter({ backend })
        openHandles.push(port)
        const result = port.write('app:key', 42 as unknown as string)
        expect(result).toEqual({ ok: false, error: { kind: 'corrupt', raw: '42' } })
        expect(backend.getItem('app:key')).toBeNull()
    })

    it('maps unexpected backend failures to unknown with the cause', () => {
        const backend = new ArmedBackend()
        const port = createLocalStorageAdapter({ backend })
        openHandles.push(port)
        const boom = new Error('disk on fire')
        backend.arm(boom)
        const result = port.read('app:key')
        expect(result).toEqual({ ok: false, error: { kind: 'unknown', cause: boom } })
    })

    it('broadcasts writes and removals to the cross-tab channel', () => {
        const port = createLocalStorageAdapter({ backend: new ArmedBackend() })
        openHandles.push(port)
        port.write('app:key', 'hello')
        port.remove('app:key')
        expect(NoopBroadcastChannel.posted.length).toBe(2)
        const first = NoopBroadcastChannel.posted[0]
        const second = NoopBroadcastChannel.posted[1]
        expect(first?.name).toBe(channelNameFor('app:key'))
        expect(decodeEnvelope(first?.data as string)).toMatchObject({ kind: 'write', key: 'app:key', d: 'hello' })
        expect(second?.name).toBe(channelNameFor('app:key'))
        expect(decodeEnvelope(second?.data as string)).toMatchObject({ kind: 'remove', key: 'app:key', d: null })
    })

    it('resolves window.localStorage lazily on every operation', () => {
        const port = createLocalStorageAdapter()
        openHandles.push(port)
        const backend = new ArmedBackend()
        const restore = installWindowBackend('localStorage', backend)
        try {
            // Installed after factory creation, yet picked up: resolution is lazy.
            expect(port.write('app:lazy', 'live')).toEqual({ ok: true, value: undefined })
            expect(backend.getItem('app:lazy')).toBe('live')
            expect(port.read('app:lazy')).toEqual({ ok: true, value: 'live' })
        } finally {
            restore()
        }
    })

    it('close() detaches listeners, completes observe$, and keeps storage usable', () => {
        const backend = new ArmedBackend()
        const port = createLocalStorageAdapter({ backend })
        openHandles.push(port)
        const seen: Array<string | null> = []
        let completed = false
        const subscription = port.observe$('app:key').subscribe({
            next: (value) => { seen.push(value) },
            complete: () => { completed = true },
        })
        backend.writeRaw('app:key', 'before-close')
        dispatchStorageEvent('app:key', 'before-close')
        expect(seen).toEqual(['before-close'])
        port.close()
        expect(completed).toBe(true)
        backend.writeRaw('app:key', 'after-close')
        dispatchStorageEvent('app:key', 'after-close')
        expect(seen).toEqual(['before-close'])
        subscription.unsubscribe()
        expect(port.write('app:key', 'still-usable')).toEqual({ ok: true, value: undefined })
        expect(port.read('app:key')).toEqual({ ok: true, value: 'still-usable' })
        let postCloseCompleted = false
        port.observe$('app:key').subscribe({ complete: () => { postCloseCompleted = true } })
        expect(postCloseCompleted).toBe(true)
    })

    it('works without BroadcastChannel through the storage-event fallback', () => {
        writeBroadcastChannel(undefined)
        const backend = new ArmedBackend()
        const port = createLocalStorageAdapter({ backend })
        openHandles.push(port)
        const seen: Array<string | null> = []
        const subscription = port.observe$('app:key').subscribe((value) => { seen.push(value) })
        expect(port.write('app:key', 'no-bc')).toEqual({ ok: true, value: undefined })
        expect(seen).toEqual([])
        backend.writeRaw('app:key', 'external')
        dispatchStorageEvent('app:key', 'external')
        expect(seen).toEqual(['external'])
        subscription.unsubscribe()
    })

    it('honours cooperative backend failures precisely', () => {
        const backend = new ArmedBackend()
        const port = createLocalStorageAdapter({ backend })
        openHandles.push(port)
        backend.arm({ kind: 'quota' })
        expect(port.write('app:key', 'x')).toEqual({ ok: false, error: { kind: 'quota' } })
        backend.arm({ kind: 'corrupt', raw: '<garbage' })
        expect(port.read('app:key')).toEqual({ ok: false, error: { kind: 'corrupt', raw: '<garbage' } })
        backend.arm({ kind: 'unknown', cause: 'boom' })
        expect(port.read('app:key')).toEqual({ ok: false, error: { kind: 'unknown', cause: 'boom' } })
        backend.arm({ kind: 'unavailable' })
        expect(port.read('app:key')).toEqual({ ok: false, error: { kind: 'unavailable' } })
        backend.arm({ kind: 'unavailable' })
        expect(port.write('app:key', 'x')).toEqual({ ok: false, error: { kind: 'unavailable' } })
    })

    it('maps shapeless thrown values to unknown with the cause', () => {
        const backend = new ArmedBackend()
        const port = createLocalStorageAdapter({ backend })
        openHandles.push(port)
        backend.arm(42)
        expect(port.write('app:key', 'x')).toEqual({ ok: false, error: { kind: 'unknown', cause: 42 } })
        backend.arm(null)
        expect(port.write('app:key', 'x')).toEqual({ ok: true, value: undefined })
    })

    it('detects quota and security shapes across browsers', () => {
        const backend = new ArmedBackend()
        const port = createLocalStorageAdapter({ backend })
        openHandles.push(port)
        backend.arm({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })
        expect(port.write('app:key', 'x')).toEqual({ ok: false, error: { kind: 'quota' } })
        backend.arm({ code: 1014 })
        expect(port.write('app:key', 'x')).toEqual({ ok: false, error: { kind: 'quota' } })
        backend.arm({ name: 'SecurityError' })
        expect(port.read('app:key')).toEqual({ ok: false, error: { kind: 'unavailable' } })
        backend.arm({ name: 'SecurityError' })
        expect(port.write('app:key', 'x')).toEqual({ ok: false, error: { kind: 'unavailable' } })
        backend.arm({ name: 'SecurityError' })
        expect(port.remove('app:key')).toEqual({ ok: false, error: { kind: 'unavailable' } })
    })

    it('reports unprintable payloads without throwing', () => {
        const backend = new ArmedBackend()
        const port = createLocalStorageAdapter({ backend })
        openHandles.push(port)
        const unprintable = new Proxy({}, {
            get(): never {
                throw new Error('unprintable')
            },
        })
        expect(port.write('app:key', unprintable as unknown as string)).toEqual({
            ok: false,
            error: { kind: 'corrupt', raw: '<unprintable>' },
        })
    })

    it('shares one subject across observers of the same key', () => {
        const backend = new ArmedBackend()
        const port = createLocalStorageAdapter({ backend })
        openHandles.push(port)
        const first: Array<string | null> = []
        const second: Array<string | null> = []
        const firstSub = port.observe$('app:key').subscribe((value) => { first.push(value) })
        const secondSub = port.observe$('app:key').subscribe((value) => { second.push(value) })
        backend.writeRaw('app:key', 'shared')
        dispatchStorageEvent('app:key', 'shared')
        expect(first).toEqual(['shared'])
        expect(second).toEqual(['shared'])
        firstSub.unsubscribe()
        secondSub.unsubscribe()
    })

    it('tolerates throwing sync handles on close', () => {
        writeBroadcastChannel(class {
            onmessage: ((event: { readonly data: unknown }) => void) | null = null
            constructor(_name: string) {}
            postMessage(_data: unknown): void {}
            close(): void {
                throw new Error('close-denied')
            }
        })
        const port = createLocalStorageAdapter({ backend: new ArmedBackend() })
        openHandles.push(port)
        port.observe$('app:key').subscribe(() => {}).unsubscribe()
        expect(() => port.close()).not.toThrow()
        expect(() => port.close()).not.toThrow()
    })
})

describe('localStorage backend resolution', () => {
    it('degrades shapeless window backends to unavailable', () => {
        const restoreWindow = installWindowBackend('localStorage', {} as Storage)
        const holder = globalThis as unknown as Record<string, unknown>
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
        delete holder['localStorage']
        try {
            const port = createLocalStorageAdapter()
            openHandles.push(port)
            expect(port.read('app:key')).toEqual({ ok: false, error: { kind: 'unavailable' } })
        } finally {
            restoreWindow()
            if (descriptor !== undefined) {
                Object.defineProperty(globalThis, 'localStorage', descriptor)
            }
        }
    })

    it('accepts function-shaped backends', () => {
        const data = new Map<string, string>()
        const fnBackend = Object.assign(
            (): void => {},
            {
                getItem: (key: string): string | null => data.get(key) ?? null,
                setItem: (key: string, value: string): void => {
                    data.set(key, value)
                },
                removeItem: (key: string): void => {
                    data.delete(key)
                },
            },
        )
        const restore = installWindowBackend('localStorage', fnBackend as unknown as Storage)
        try {
            const port = createLocalStorageAdapter()
            openHandles.push(port)
            expect(port.write('app:key', 'fn')).toEqual({ ok: true, value: undefined })
            expect(port.read('app:key')).toEqual({ ok: true, value: 'fn' })
        } finally {
            restore()
        }
    })

    it('falls back to the globalThis backend when window lacks one', () => {
        const restoreWindow = installWindowBackend('localStorage', {} as Storage)
        const holder = globalThis as unknown as Record<string, unknown>
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
        const backend = new ArmedBackend()
        Object.defineProperty(globalThis, 'localStorage', { value: backend, configurable: true, writable: true })
        try {
            const port = createLocalStorageAdapter()
            openHandles.push(port)
            expect(port.write('app:key', 'global')).toEqual({ ok: true, value: undefined })
            expect(backend.getItem('app:key')).toBe('global')
        } finally {
            restoreWindow()
            if (descriptor === undefined) {
                delete holder['localStorage']
            } else {
                Object.defineProperty(globalThis, 'localStorage', descriptor)
            }
        }
    })

    it('reports unavailable when every probe misses', () => {
        const restoreWindow = installWindowBackend('localStorage', {} as Storage)
        const holder = globalThis as unknown as Record<string, unknown>
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
        delete holder['localStorage']
        try {
            const port = createLocalStorageAdapter()
            openHandles.push(port)
            expect(port.read('app:key')).toEqual({ ok: false, error: { kind: 'unavailable' } })
            expect(port.write('app:key', 'x')).toEqual({ ok: false, error: { kind: 'unavailable' } })
        } finally {
            restoreWindow()
            if (descriptor !== undefined) {
                Object.defineProperty(globalThis, 'localStorage', descriptor)
            }
        }
    })
})

describe('storage registry (via ./index.js)', () => {
    it('resolves the localStorage keyword to a working port', () => {
        const restoreLocal = installWindowBackend('localStorage', new ArmedBackend())
        const restoreSession = installWindowBackend('sessionStorage', new ArmedBackend())
        try {
            const registry = createStorageAdapters()
            const port = registry.resolve('localStorage')
            expect(port).not.toBeNull()
            expect(port?.write('app:registry', 'v')).toEqual({ ok: true, value: undefined })
            expect(port?.read('app:registry')).toEqual({ ok: true, value: 'v' })
            registry.close()
        } finally {
            restoreLocal()
            restoreSession()
        }
    })

    it('returns the same instance per keyword (lazy singletons)', () => {
        const registry = createStorageAdapters()
        expect(registry.resolve('localStorage')).toBe(registry.resolve('localStorage'))
        expect(registry.resolve('sessionStorage')).toBe(registry.resolve('sessionStorage'))
        registry.close()
    })

    it('resolves unknown keywords to null for the UNKNOWN_SERVICE path', () => {
        const registry = createStorageAdapters()
        expect(registry.resolve('indexedDb')).toBeNull()
        expect(registry.resolve('')).toBeNull()
        registry.close()
    })
})
