/**
 * Deterministic domain fakes for usecase, application, and infrastructure tests.
 *
 * This module is pure: no DOM access, no real timers, no `requestAnimationFrame`,
 * no `setTimeout` or `queueMicrotask`. All time flows through the fake
 * `SchedulerPort`; every task waits in an explicit FIFO queue until a `flush*`
 * driver runs it. It runs in a plain Node environment.
 *
 * Testing-helper exemption: this file has NO sibling `.test.ts`. Per the docs
 * 10 section 10.4 testing-helpers rule, `src/testing/` (here
 * `src/domain/testing/`) helpers are shared fixtures, not units under test.
 * They are exercised indirectly by every usecase suite plus the port contract
 * suites, and v0.1.0 does not publish a `testing` subpath.
 *
 * What this module exports, and what stays application-owned:
 * - `createFakeHost`: in-memory `HostPort` with chainable `parent` links,
 *   `setConnected` / `setParent` / `adoptTo` drivers, a hot `lifecycle$`
 *   Subject, and `on()` with `signal` / `once` semantics. It does not emulate
 *   `MutationObserver`, shadow composition, or W3C Context Protocol dispatch;
 *   those belong to infrastructure adapters.
 * - `createFakeScheduler`: deterministic `SchedulerPort`. `frame` degrades to
 *   a microtask (matching the port contract where `requestAnimationFrame` is
 *   absent). `flushAll` drains microtasks and timeouts until both queues are
 *   empty. Delay values never gate execution.
 * - `createFakeStorage`: map-backed `StoragePort` with one-shot `failNext`
 *   failures and `emitExternal` cross-tab simulation. Self-writes never reflux
 *   through `observe$`. Serialization and version envelopes live above the
 *   port (see the hydrate usecase).
 * - `createFakeScopeTransport`: in-memory provider registry over `HostPort`
 *   parent chains with `provide` / `revoke`, sync `request` / `requestAll`,
 *   cold `watch` / `watchAll` (single first-emit, multi first-non-empty, empty
 *   never settles), pending tracking, and `triggerWake` for reparent and
 *   reconnect tests. It does not implement per-Document registries, token-bucket
 *   batching, `maxPendingPerDocument` backpressure, or microtask-batched retry;
 *   those belong to infrastructure with a real `SchedulerPort`.
 */

import { Observable, Subject } from 'rxjs'
import type { HostLifecycleEvent, HostPort } from '../ports/host.js'
import type { MaybePromise } from '../ports/storage.js'
import type { SchedulerPort } from '../ports/scheduler.js'
import type { StorageError, StoragePort, StorageResult } from '../ports/storage.js'
import type { ScopeResolution, ScopeTransportPort } from '../ports/scope-transport.js'
import type { Token } from '../model/token.js'

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
 * In-memory `HostPort` with deterministic drivers for connection, reparenting,
 * adoption, and native-event dispatch. No DOM access, no timers.
 */
export interface FakeHost extends HostPort<unknown> {
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
     * Repoints the scope parent, enabling chainable reparent tests.
     *
     * @param parent Next parent scope host, or null at the scope root.
     */
    setParent(parent: HostPort | null): void
    /**
     * Emits an `adopt` lifecycle event carrying the new owner.
     *
     * @param owner Adopting document or owner marker.
     */
    adoptTo(owner: unknown): void
}

interface FakeHostListenerEntry {
    readonly listener: (event: unknown) => void
    readonly once: boolean
}

/**
 * Creates an in-memory host with deterministic connection and event drivers.
 * Parent links are chainable: pass any `HostPort` (including another fake) as
 * `parent` to build ancestor chains for scope-resolution tests.
 *
 * @param init Optional token, connection, parent, and native overrides.
 * @returns A controllable fake host implementing `HostPort`.
 * @example
 * ```ts
 * import { createFakeHost } from './fakes.js'
 *
 * const root = createFakeHost({ token: 'app:root', connected: true })
 * const leaf = createFakeHost({ parent: root })
 * leaf.setConnected(true)
 * ```
 */
export function createFakeHost(init: FakeHostInit = {}): FakeHost {
    let connected = init.connected ?? false
    let parent: HostPort | null = init.parent ?? null
    const token = init.token ?? null
    const nativeValue = init.nativeValue ?? {}
    const lifecycle = new Subject<HostLifecycleEvent>()
    const listeners = new Map<string, Set<FakeHostListenerEntry>>()
    return {
        token,
        get isConnected() {
            return connected
        },
        get parent() {
            return parent
        },
        lifecycle$: lifecycle.asObservable(),
        on(type, listener, options = {}) {
            if (options.signal?.aborted === true) {
                return () => {}
            }
            const entry: FakeHostListenerEntry = { listener, once: options.once ?? false }
            let set = listeners.get(type)
            if (set === undefined) {
                set = new Set<FakeHostListenerEntry>()
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
        setParent(next) {
            parent = next
        },
        adoptTo(owner) {
            lifecycle.next({ type: 'adopt', owner })
        },
    }
}

/**
 * Deterministic in-memory `SchedulerPort`. Tasks never run on their own: they
 * wait in explicit FIFO queues until the matching `flush*` driver runs them.
 * No real timers, no microtask queue, no `requestAnimationFrame`.
 */
export interface FakeScheduler extends SchedulerPort {
    /**
     * Runs every queued microtask FIFO, including tasks enqueued mid-flush,
     * then empties the queue.
     */
    flushMicrotasks(): void
    /**
     * Runs every queued timeout FIFO in one batch, then empties the queue.
     * Delay values only satisfy the signature; they never gate execution.
     */
    flushTimeouts(): void
    /**
     * Drains microtasks and timeouts until both queues are empty. Timeout
     * tasks that enqueue microtasks are covered by re-draining. Bounded to a
     * finite pass count; re-enqueueing forever is a test bug, not a hang.
     */
    flushAll(): void
    /** Counts queued microtasks without running them. */
    pendingMicrotasks(): number
    /** Counts queued (uncancelled) timeouts without running them. */
    pendingTimeouts(): number
}

/**
 * Creates a deterministic scheduler fake. `frame` degrades to a microtask,
 * matching the port contract for environments without `requestAnimationFrame`.
 *
 * @returns A controllable fake scheduler implementing `SchedulerPort`.
 * @example
 * ```ts
 * import { createFakeScheduler } from './fakes.js'
 *
 * const scheduler = createFakeScheduler()
 * scheduler.microtask(() => {})
 * scheduler.flushMicrotasks()
 * ```
 */
export function createFakeScheduler(): FakeScheduler {
    const microtasks: Array<() => void> = []
    const timeouts = new Map<number, () => void>()
    let nextId = 1

    const removeMicrotask = (task: () => void): void => {
        const index = microtasks.indexOf(task)
        if (index >= 0) {
            microtasks.splice(index, 1)
        }
    }

    const drainMicrotasks = (): void => {
        let task = microtasks.shift()
        while (task !== undefined) {
            task()
            task = microtasks.shift()
        }
    }

    const drainTimeouts = (): void => {
        const pending = [...timeouts.values()]
        timeouts.clear()
        for (const task of pending) {
            task()
        }
    }

    return {
        microtask(task) {
            microtasks.push(task)
        },
        timeout(task, ms) {
            void ms
            const id = nextId
            nextId += 1
            timeouts.set(id, task)
            return () => {
                timeouts.delete(id)
            }
        },
        frame(task) {
            microtasks.push(task)
            return () => {
                removeMicrotask(task)
            }
        },
        flushMicrotasks() {
            drainMicrotasks()
        },
        flushTimeouts() {
            drainTimeouts()
        },
        flushAll() {
            for (let pass = 0; pass < 100; pass += 1) {
                if (microtasks.length === 0 && timeouts.size === 0) {
                    return
                }
                drainMicrotasks()
                drainTimeouts()
            }
        },
        pendingMicrotasks() {
            return microtasks.length
        },
        pendingTimeouts() {
            return timeouts.size
        },
    }
}

/**
 * In-memory `StoragePort` handle with drivers for external changes and
 * one-shot failures. Synchronous by default and never throws: failures surface
 * as `{ ok: false, error }` results.
 */
export interface FakeStorageHandle {
    /** Port under test. */
    readonly port: StoragePort
    /**
     * Simulates an external (cross-tab) change: updates the stored value and
     * notifies `observe$` subscribers, unlike a self-write which stays silent.
     *
     * @param key Storage key.
     * @param value New external value, or null for an external removal.
     */
    emitExternal(key: string, value: string | null): void
    /**
     * Arms a one-shot failure for the next `read`, `write`, or `remove` call.
     * The failure is consumed exactly once, then operations succeed again.
     *
     * @param kind Error kind reported by the next operation.
     */
    failNext(kind: StorageError['kind']): void
    /**
     * Reads the live map contents without triggering observers.
     *
     * @returns A snapshot copy of the stored entries.
     */
    contents(): ReadonlyMap<string, string>
    /**
     * Clears every stored entry without notifying observers.
     */
    clear(): void
}

/**
 * Creates an in-memory storage handle. No DOM access, no timers.
 *
 * @returns A controllable fake storage handle.
 * @example
 * ```ts
 * import { createFakeStorage } from './fakes.js'
 *
 * const storage = createFakeStorage()
 * const read = await storage.port.read('app:missing')
 * ```
 */
export function createFakeStorage(): FakeStorageHandle {
    const store = new Map<string, string>()
    const subjects = new Map<string, Subject<string | null>>()
    let armed: StorageError | null = null

    const errorFor = (kind: StorageError['kind']): StorageError => {
        switch (kind) {
            case 'unavailable':
                return { kind: 'unavailable' }
            case 'corrupt':
                return { kind: 'corrupt', raw: '<garbage' }
            case 'quota':
                return { kind: 'quota' }
            case 'unknown':
                return { kind: 'unknown', cause: 'boom' }
        }
    }

    const takeArmed = (): StorageError | null => {
        const failure = armed
        armed = null
        return failure
    }

    const subjectFor = (key: string): Subject<string | null> => {
        const existing = subjects.get(key)
        if (existing !== undefined) {
            return existing
        }
        const created = new Subject<string | null>()
        subjects.set(key, created)
        return created
    }

    const port: StoragePort = {
        read(key) {
            const failure = takeArmed()
            if (failure !== null) {
                return { ok: false, error: failure }
            }
            return { ok: true, value: store.get(key) ?? null }
        },
        write(key, value) {
            const failure = takeArmed()
            if (failure !== null) {
                return { ok: false, error: failure }
            }
            store.set(key, value)
            return { ok: true, value: undefined }
        },
        remove(key) {
            const failure = takeArmed()
            if (failure !== null) {
                return { ok: false, error: failure }
            }
            store.delete(key)
            return { ok: true, value: undefined }
        },
        observe$(key) {
            return subjectFor(key).asObservable()
        },
    }

    return {
        port,
        emitExternal(key, value) {
            if (value === null) {
                store.delete(key)
            } else {
                store.set(key, value)
            }
            subjects.get(key)?.next(value)
        },
        failNext(kind) {
            armed = errorFor(kind)
        },
        contents() {
            return new Map(store)
        },
        clear() {
            store.clear()
        },
    }
}

interface FakeScopeRegistration {
    readonly token: Token
    readonly at: HostPort
    readonly value: unknown
    readonly order: number
}

interface FakeScopePendingEntry {
    readonly token: Token
    readonly retry: () => boolean
}

/**
 * Extra metadata accepted by {@link FakeScopeWorld.provide}. `depth` is
 * accepted for signature compatibility with ordering tests but is always
 * recomputed from the parent chain; an explicit `depth` never overrides the
 * walk. `order` defaults to registration sequence when omitted.
 */
export interface FakeProvideOptions {
    /** True when the registration is multi-valued (ordering only). */
    readonly multi?: boolean
    /** Accepted but ignored; depth is always recomputed from parent hops. */
    readonly depth?: number
    /** Explicit registration order; defaults to call sequence. */
    readonly order?: number
}

/**
 * In-memory scope-transport world: a controllable provider registry over
 * `HostPort` parent chains, plus the transport under test. String tokens match
 * by value; private tokens match by reference. No DOM access, no timers: every
 * wake-up is a synchronous `provide()` call or an explicit `triggerWake()`.
 */
export interface FakeScopeWorld {
    /** Transport under test. */
    readonly transport: ScopeTransportPort
    /**
     * Creates a connected fake host whose scope chain starts at `parent`.
     * The returned host supports `setConnected` / `setParent` for reparent
     * and disconnect tests.
     *
     * @param parent Parent scope host, or null for a scope root.
     * @returns A controllable fake host.
     */
    createHost(parent?: HostPort | null): FakeHost
    /**
     * Registers a provider value at a host and synchronously wakes matching
     * pending watches.
     *
     * @param token Token to provide (string or private).
     * @param value Provided value; async promises pass through untouched.
     * @param at Host holding the registration.
     * @param options Optional multi / depth / order metadata.
     * @returns Revoke function removing exactly this registration.
     */
    provide<T>(token: Token, value: MaybePromise<T>, at: HostPort, options?: FakeProvideOptions): () => void
    /** Counts currently pending (unsettled, unaborted) watches. */
    pendingCount(): number
    /**
     * Re-evaluates every pending watch once, settling those whose ancestry now
     * hits (for example after a reparent with no new `provide`). Settled
     * entries are removed.
     *
     * @returns The number of entries settled by this pass.
     */
    triggerWake(): number
}

/**
 * Creates an in-memory scope-transport world with no DOM and no timers.
 *
 * @returns A controllable world exposing the transport under test.
 * @example
 * ```ts
 * import { createFakeScopeTransport } from './fakes.js'
 *
 * const world = createFakeScopeTransport()
 * const leaf = world.createHost()
 * world.provide('app:theme', 'dark', leaf)
 * ```
 */
export function createFakeScopeTransport(): FakeScopeWorld {
    const registrations = new Map<Token, Array<FakeScopeRegistration>>()
    const pendings: Array<FakeScopePendingEntry> = []
    let order = 0

    const removePending = (entry: FakeScopePendingEntry): void => {
        const index = pendings.indexOf(entry)
        if (index >= 0) {
            pendings.splice(index, 1)
        }
    }

    const registrationsAt = (token: Token, host: HostPort): Array<FakeScopeRegistration> => {
        return (registrations.get(token) ?? []).filter((registration) => registration.at === host)
    }

    const takeNearest = (token: Token, from: HostPort): FakeScopeRegistration | null => {
        let current: HostPort | null = from
        while (current !== null) {
            const hit = registrationsAt(token, current)[0]
            if (hit !== undefined) {
                return hit
            }
            current = current.parent
        }
        return null
    }

    const takeAll = (
        token: Token,
        from: HostPort,
        direction: 'bottomUp' | 'topDown',
    ): Array<FakeScopeRegistration> => {
        const hits: Array<{ depth: number, order: number, registration: FakeScopeRegistration }> = []
        let current: HostPort | null = from
        let depth = 0
        while (current !== null) {
            for (const registration of registrationsAt(token, current)) {
                hits.push({ depth, order: registration.order, registration })
            }
            current = current.parent
            depth += 1
        }
        hits.sort((a, b) => direction === 'bottomUp'
            ? a.depth - b.depth || a.order - b.order
            : b.depth - a.depth || a.order - b.order)
        return hits.map((hit) => hit.registration)
    }

    const snapshot = <T>(registration: FakeScopeRegistration): ScopeResolution<T> => ({
        value: registration.value as T,
        unsubscribe: () => {},
    })

    const wakeToken = (token: Token): void => {
        for (let index = pendings.length - 1; index >= 0; index -= 1) {
            const entry = pendings[index]
            if (entry !== undefined && entry.token === token && entry.retry()) {
                pendings.splice(index, 1)
            }
        }
    }

    const watchWith = <T>(
        token: Token,
        from: HostPort,
        signal: AbortSignal | undefined,
        settle: (subscriber: { next(value: T): void, complete(): void }) => boolean,
    ): Observable<T> => new Observable<T>((subscriber) => {
        if (signal?.aborted === true) {
            subscriber.complete()
            return undefined
        }
        const entry: FakeScopePendingEntry = {
            token,
            retry: () => settle(subscriber),
        }
        if (entry.retry()) {
            return undefined
        }
        pendings.push(entry)
        const onAbort = (): void => {
            removePending(entry)
            subscriber.complete()
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        return () => {
            removePending(entry)
            signal?.removeEventListener('abort', onAbort)
        }
    })

    const transport: ScopeTransportPort = {
        request(token, from) {
            const hit = takeNearest(token, from)
            if (hit === null) {
                return null
            }
            return snapshot(hit)
        },
        requestAll(token, from, options) {
            return takeAll(token, from, options?.direction ?? 'bottomUp').map((registration) => snapshot(registration))
        },
        watch(token, from, options) {
            return watchWith(token, from, options?.signal, (subscriber) => {
                const hit = takeNearest(token, from)
                if (hit === null) {
                    return false
                }
                subscriber.next(snapshot(hit))
                subscriber.complete()
                return true
            })
        },
        watchAll(token, from, options) {
            const direction = options?.direction ?? 'bottomUp'
            return watchWith(token, from, options?.signal, (subscriber) => {
                const hits = takeAll(token, from, direction)
                if (hits.length === 0) {
                    return false
                }
                subscriber.next(hits.map((registration) => snapshot(registration)))
                subscriber.complete()
                return true
            })
        },
    }

    return {
        transport,
        createHost(parent: HostPort | null = null) {
            return createFakeHost({ connected: true, parent })
        },
        provide(token, value, at, options) {
            const assignedOrder = options?.order ?? order
            if (options?.order === undefined) {
                order += 1
            } else {
                order = Math.max(order, assignedOrder + 1)
            }
            void options?.multi
            void options?.depth
            const registration: FakeScopeRegistration = { token, at, value, order: assignedOrder }
            const list = registrations.get(token)
            if (list === undefined) {
                registrations.set(token, [registration])
            } else {
                list.push(registration)
            }
            wakeToken(token)
            return () => {
                const current = registrations.get(token)
                if (current === undefined) {
                    return
                }
                const index = current.indexOf(registration)
                if (index >= 0) {
                    current.splice(index, 1)
                }
            }
        },
        pendingCount() {
            return pendings.length
        },
        triggerWake() {
            let settled = 0
            for (let index = pendings.length - 1; index >= 0; index -= 1) {
                const entry = pendings[index]
                if (entry !== undefined && entry.retry()) {
                    pendings.splice(index, 1)
                    settled += 1
                }
            }
            return settled
        },
    }
}
