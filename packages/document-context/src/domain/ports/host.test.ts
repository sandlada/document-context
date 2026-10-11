import { describe, expect, it } from 'vitest'
import { Subject } from 'rxjs'
import type { HostLifecycleEvent, HostPort } from './host.js'

/**
 * Initialization options for {@link createFakeHost}. Every field is optional;
 * omitted fields fall back to anonymous, disconnected, scope-root defaults.
 */
export interface FakeHostInit {
    /** Normalized keyed identity, or null for an anonymous host. */
    readonly token?: string | null
    /** Initial connection flag. */
    readonly connected?: boolean
    /** Parent scope host, or null at the scope root. */
    readonly parent?: HostPort | null
    /** Value returned by `native()`. */
    readonly nativeValue?: unknown
}

/**
 * In-memory `HostPort` with deterministic drivers for connection, adoption,
 * and native-event dispatch. No DOM access, no timers.
 */
export interface FakeHostPort extends HostPort {
    /**
     * Delivers a synthetic native event to every matching `on()` listener.
     *
     * @param type Native event name to deliver.
     * @param event Payload handed to each listener.
     */
    dispatch(type: string, event: unknown): void
    /**
     * Flips the connection flag, emitting `connect` or `disconnect` on
     * `lifecycle$` only when the value actually changes.
     *
     * @param connected Next connection flag.
     */
    setConnected(connected: boolean): void
    /**
     * Emits an `adopt` lifecycle event carrying the new owner.
     *
     * @param owner Adopting document or owner marker.
     */
    adoptTo(owner: unknown): void
}

interface ListenerEntry {
    readonly listener: (event: unknown) => void
    readonly once: boolean
}

/**
 * Creates an in-memory host with deterministic connection and event drivers.
 *
 * @param init Optional token, connection, parent, and native overrides.
 * @returns A controllable fake host implementing `HostPort`.
 * @example
 * ```ts
 * import { createFakeHost } from './host.test.js'
 *
 * const host = createFakeHost({ token: 'app:box', connected: true })
 * ```
 */
export function createFakeHost(init: FakeHostInit = {}): FakeHostPort {
    let connected = init.connected ?? false
    const token = init.token ?? null
    const parent = init.parent ?? null
    const nativeValue = init.nativeValue ?? {}
    const lifecycle = new Subject<HostLifecycleEvent>()
    const listeners = new Map<string, Set<ListenerEntry>>()
    return {
        token,
        get isConnected() {
            return connected
        },
        parent,
        lifecycle$: lifecycle.asObservable(),
        on(type, listener, options = {}) {
            if (options.signal?.aborted === true) {
                return () => {}
            }
            const entry: ListenerEntry = { listener, once: options.once ?? false }
            let set = listeners.get(type)
            if (set === undefined) {
                set = new Set<ListenerEntry>()
                listeners.set(type, set)
            }
            set.add(entry)
            const signal = options.signal
            const off = (): void => {
                listeners.get(type)?.delete(entry)
                if (signal !== undefined) {
                    signal.removeEventListener('abort', onAbort)
                }
            }
            const onAbort = (): void => {
                off()
            }
            signal?.addEventListener('abort', onAbort, { once: true })
            return off
        },
        native() {
            return nativeValue
        },
        dispatch(type, event) {
            const set = listeners.get(type)
            if (set === undefined) {
                return
            }
            for (const entry of [...set]) {
                if (entry.once) {
                    set.delete(entry)
                }
                entry.listener(event)
            }
        },
        setConnected(next) {
            if (next === connected) {
                return
            }
            connected = next
            lifecycle.next({ type: next ? 'connect' : 'disconnect' })
        },
        adoptTo(owner) {
            lifecycle.next({ type: 'adopt', owner })
        },
    }
}

/**
 * Reusable `HostPort` contract suite. Every adapter (DOM, fake, SSR) runs the
 * same assertions by supplying a factory for a controllable host.
 *
 * @param create Factory returning a fresh controllable host per test.
 * @example
 * ```ts
 * import { describe } from 'vitest'
 * import { createFakeHost, hostPortContract } from './host.test.js'
 *
 * describe('fake host', () => {
 *     hostPortContract(createFakeHost)
 * })
 * ```
 */
export function hostPortContract(create: (init?: FakeHostInit) => FakeHostPort): void {
    it('exposes the normalized keyed identity as token', () => {
        expect(create().token).toBeNull()
        expect(create({ token: 'app:box' }).token).toBe('app:box')
    })

    it('reflects the connection flag', () => {
        expect(create().isConnected).toBe(false)
        expect(create({ connected: true }).isConnected).toBe(true)
        const host = create()
        host.setConnected(true)
        expect(host.isConnected).toBe(true)
        host.setConnected(false)
        expect(host.isConnected).toBe(false)
    })

    it('walks the scope chain through parent links', () => {
        const root = create({ token: 'app:root', connected: true })
        const middle = create({ parent: root })
        const leaf = create({ parent: middle })
        expect(leaf.parent).toBe(middle)
        expect(leaf.parent?.parent).toBe(root)
        expect(root.parent).toBeNull()
        const chain: Array<HostPort> = []
        let current: HostPort | null = leaf
        while (current !== null) {
            chain.push(current)
            current = current.parent
        }
        expect(chain).toEqual([leaf, middle, root])
    })

    it('emits connect, adopt, and disconnect lifecycle events in order', () => {
        const host = create()
        const events: Array<HostLifecycleEvent> = []
        const subscription = host.lifecycle$.subscribe((event) => {
            events.push(event)
        })
        host.setConnected(true)
        const owner = { name: 'owner-document' }
        host.adoptTo(owner)
        host.setConnected(false)
        expect(events).toEqual([
            { type: 'connect' },
            { type: 'adopt', owner },
            { type: 'disconnect' },
        ])
        subscription.unsubscribe()
    })

    it('delivers native events to on() listeners until the off function runs', () => {
        const host = create()
        const seen: Array<unknown> = []
        const off = host.on('input', (event) => {
            seen.push(event)
        })
        host.dispatch('input', { value: 'a' })
        expect(seen).toEqual([{ value: 'a' }])
        off()
        host.dispatch('input', { value: 'b' })
        expect(seen).toEqual([{ value: 'a' }])
    })

    it('removes once listeners after the first delivery', () => {
        const host = create()
        let calls = 0
        host.on('input', () => {
            calls += 1
        }, { once: true })
        host.dispatch('input', null)
        host.dispatch('input', null)
        expect(calls).toBe(1)
    })

    it('never attaches a listener whose signal is already aborted', () => {
        const host = create()
        let calls = 0
        const off = host.on('input', () => {
            calls += 1
        }, { signal: AbortSignal.abort() })
        expect(typeof off).toBe('function')
        host.dispatch('input', null)
        expect(calls).toBe(0)
        off()
    })

    it('detaches the listener when the signal aborts later', () => {
        const host = create()
        let calls = 0
        const controller = new AbortController()
        host.on('input', () => {
            calls += 1
        }, { signal: controller.signal })
        controller.abort()
        host.dispatch('input', null)
        expect(calls).toBe(0)
    })

    it('exposes the native node through the native() escape hatch', () => {
        const marker = { fakeNode: true }
        expect(create({ nativeValue: marker }).native()).toBe(marker)
    })
}

describe('FakeHostPort (in-memory host)', () => {
    hostPortContract(createFakeHost)
})
