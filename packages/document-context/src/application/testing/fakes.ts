/**
 * Test doubles for the ports.
 *
 * The fakes are deliberately strict: they never touch the DOM, never use real timers and never
 * behave more loosely than the real adapters. They live in the application layer so that both the
 * unit tests and the integration tests can use them.
 */

import { DocumentContextError } from '../../domain/model/errors'
import type { HostAdapter, ConnectivityPort, TokensPort } from '../../domain/ports/host'
import type { SchedulerPort } from '../../domain/ports/scheduler'
import type {
    ContextRequestDetail,
    ProviderDeclaration,
    ScopeTransportPort,
} from '../../domain/ports/scope-transport'
import { contextRequestSource } from '../../domain/ports/scope-transport'
import type { Host, HostEventListener, HostListenerOptions } from '../../domain/model/session'
import { createApplication, type Application } from '../application'
import type { ApplicationLimits } from '../context'

/**
 * A deterministic clock.
 *
 * Time only moves when the test moves it. The fake never touches `setTimeout`,
 * `queueMicrotask`, `Date.now()` or `performance.now()`.
 */
export interface FakeClock extends SchedulerPort {
    /** The current time in milliseconds. */
    now(): number
    /**
     * Advance the clock, running every timeout that becomes due.
     *
     * @param ms - The number of milliseconds to advance.
     */
    advance(ms: number): void
    /**
     * Advance the clock to an absolute point in time.
     *
     * @param time - The absolute time.
     */
    advanceTo(time: number): void
    /**
     * Run every queued microtask, including the ones queued during the flush.
     *
     * @returns A promise that resolves when the queue is empty.
     */
    flushMicrotasks(): Promise<void>
    /** The number of timeouts waiting to fire. */
    pendingTimeouts(): number
    /** The number of microtasks waiting to run. */
    pendingMicrotasks(): number
}

interface ScheduledTimeout {
    readonly id: number
    readonly due: number
    readonly task: () => void
    cancelled: boolean
}

/**
 * Create a deterministic clock.
 *
 * @returns The clock.
 */
export function createFakeClock(): FakeClock {
    let now = 0
    let nextId = 1
    const microtasks: (() => void)[] = []
    const timeouts: ScheduledTimeout[] = []

    const microtask = (task: () => void): (() => void) => {
        let cancelled = false
        microtasks.push(() => {
            if (!cancelled) {
                task()
            }
        })
        return () => {
            cancelled = true
        }
    }

    const timeout = (task: () => void, delayMs: number): (() => void) => {
        const entry: ScheduledTimeout = {
            id: nextId++,
            due: now + delayMs,
            task,
            cancelled: false,
        }
        timeouts.push(entry)
        return () => {
            entry.cancelled = true
        }
    }

    const frame = (task: () => void): (() => void) => microtask(task)

    const advance = (ms: number): void => {
        now += ms
        const due = timeouts
            .filter((entry) => !entry.cancelled && entry.due <= now)
            .sort((left, right) => left.due - right.due || left.id - right.id)
        for (const entry of due) {
            entry.cancelled = true
            entry.task()
        }
        timeouts.splice(
            0,
            timeouts.length,
            ...timeouts.filter((entry) => !entry.cancelled),
        )
    }

    const advanceTo = (time: number): void => {
        advance(Math.max(0, time - now))
    }

    const flushMicrotasks = async (): Promise<void> => {
        let guard = 0
        while (microtasks.length > 0) {
            guard += 1
            if (guard > 10000) {
                throw new Error('The fake clock microtask queue did not settle.')
            }
            const task = microtasks.shift()
            task?.()
            await Promise.resolve()
        }
        await Promise.resolve()
    }

    return {
        microtask,
        timeout,
        frame,
        now: () => now,
        advance,
        advanceTo,
        flushMicrotasks,
        pendingTimeouts: () => timeouts.filter((entry) => !entry.cancelled).length,
        pendingMicrotasks: () => microtasks.length,
    }
}

/**
 * A host that a test can move around.
 */
export interface FakeHost extends Host {
    /** Change the composed ancestor of this host. */
    setParent(parent: Host | null): void
    /** Change the connectivity of this host. */
    setConnected(connected: boolean): void
    /** The listeners registered through `on`. */
    readonly listeners: Map<string, Set<HostEventListener>>
}

/**
 * Create a fake host.
 *
 * @param kind - The host kind.
 * @returns The fake host.
 */
export function createFakeHost(kind: 'element' | 'server' = 'element'): FakeHost {
    let parent: Host | null = null
    let connected = true
    const listeners = new Map<string, Set<HostEventListener>>()
    const host: FakeHost = {
        kind,
        get isConnected(): boolean {
            return connected
        },
        get parent(): Host | null {
            return parent
        },
        native: () => host,
        on(type: string, listener: HostEventListener, options?: HostListenerOptions): () => void {
            if (options?.signal?.aborted === true) {
                return () => undefined
            }
            const set = listeners.get(type) ?? new Set<HostEventListener>()
            set.add(listener)
            listeners.set(type, set)
            const remove = (): void => {
                set.delete(listener)
            }
            options?.signal?.addEventListener('abort', remove, { once: true })
            return () => {
                remove()
                options?.signal?.removeEventListener('abort', remove)
            }
        },
        setParent(next: Host | null): void {
            parent = next
        },
        setConnected(next: boolean): void {
            connected = next
        },
        listeners,
    }
    return host
}

/** A fake host adapter with a deterministic clock. */
export interface FakeHostAdapter extends HostAdapter<Host, FakeHost> {
    /** The deterministic clock of this adapter. */
    readonly clock: FakeClock
    /** The fake scope transport of this adapter. */
    readonly scope: FakeScopeTransport
    /** The fake connectivity of this adapter. */
    readonly connectivity: FakeConnectivity
    /** Create a fake host. */
    createHost(kind?: 'element' | 'server'): FakeHost
    /** Change the connectivity of a host and notify its subscribers. */
    setConnected(host: Host, connected: boolean): void
    /** Report that a host was adopted into another owner without disconnecting it. */
    adopt(host: Host, owner: unknown): void
}

export interface FakeConnectivity extends ConnectivityPort {
    /** The current connectivity of a host. */
    readonly states: Map<Host, boolean>
}

export interface FakeScopeTransport extends ScopeTransportPort {
    /** The provider declarations per host. */
    readonly declarations: Map<Host, ProviderDeclaration[]>
    /** The request handlers per host. */
    readonly handlers: Map<Host, ((detail: ContextRequestDetail) => void)[]>
    /** The number of dispatched requests. */
    requestCount(): number
    /** The number of `context-mount` announcements. */
    mountAnnouncementCount(): number
    /** The number of `context-dispose` announcements. */
    disposeAnnouncementCount(): number
}

/**
 * A test application wired to the fake ports.
 */
export interface TestApplication {
    /** The application under test. */
    readonly app: Application<Host, FakeHost>
    /** The fake host adapter. */
    readonly adapter: FakeHostAdapter
    /** The deterministic clock. */
    readonly clock: FakeClock
}

/**
 * Create an application wired to the fake ports.
 *
 * @param options - Optional limit overrides.
 * @returns The test application.
 */
export function createTestApplication(options?: {
    readonly limits?: Partial<ApplicationLimits>
}): TestApplication {
    const adapter = createFakeHostAdapter()
    const app =
        options?.limits === undefined
            ? createApplication<Host, FakeHost>({ host: adapter })
            : createApplication<Host, FakeHost>({ host: adapter, limits: options.limits })
    return { app, adapter, clock: adapter.clock }
}

/**
 * Create a fake host adapter.
 *
 * @returns The adapter.
 */
export function createFakeHostAdapter(): FakeHostAdapter {
    const clock = createFakeClock()
    const states = new Map<Host, boolean>()
    const subscriptions = new Map<Host, Set<(connected: boolean, owner?: unknown) => void>>()
    const structureListeners = new Map<Host, Set<() => void>>()
    const declarations = new Map<Host, ProviderDeclaration[]>()
    const handlers = new Map<Host, ((detail: ContextRequestDetail) => void)[]>()
    const providerListeners = new Set<() => void>()
    const keys = new Map<Host, string>()
    let requests = 0
    let mounts = 0
    let disposals = 0

    const connectivity: FakeConnectivity = {
        states,
        isConnected(host: Host): boolean {
            return states.get(host) ?? true
        },
        subscribe(host: Host, listener: (connected: boolean, owner?: unknown) => void): () => void {
            const set = subscriptions.get(host) ?? new Set<(connected: boolean, owner?: unknown) => void>()
            set.add(listener)
            subscriptions.set(host, set)
            return () => {
                set.delete(listener)
            }
        },
        subscribeStructure(host: Host, listener: () => void): () => void {
            const set = structureListeners.get(host) ?? new Set<() => void>()
            set.add(listener)
            structureListeners.set(host, set)
            return () => {
                set.delete(listener)
            }
        },
    }

    const setConnected = (host: Host, connected: boolean): void => {
        const previous = states.get(host) ?? true
        if (previous === connected) {
            return
        }
        states.set(host, connected)
        for (const listener of [...(subscriptions.get(host) ?? [])]) {
            listener(connected)
        }
    }

    const adopt = (host: Host, owner: unknown): void => {
        for (const listener of [...(subscriptions.get(host) ?? [])]) {
            listener(states.get(host) ?? true, owner)
        }
    }

    const scope: FakeScopeTransport = {
        declarations,
        handlers,
        // The fake environment is fully indexed: a miss is final.
        authoritative: true,
        hostOf(target: unknown): Host | null {
            if (typeof target !== 'object' || target === null) {
                return null
            }
            if (!('kind' in target) || !('parent' in target)) {
                return null
            }
            return target as Host
        },
        contains(ancestor: Host, descendant: Host): boolean {
            let current: Host | null = descendant
            while (current !== null) {
                if (current === ancestor) {
                    return true
                }
                current = current.parent
            }
            return false
        },
        declarationsOf(host: Host): readonly ProviderDeclaration[] {
            return declarations.get(host) ?? []
        },
        declare(host: Host, entries: readonly ProviderDeclaration[]): void {
            declarations.set(host, [...entries])
        },
        undeclare(host: Host): void {
            declarations.delete(host)
        },
        onRequest(host: Host, handler: (detail: ContextRequestDetail) => void): () => void {
            const list = handlers.get(host) ?? []
            list.push(handler)
            handlers.set(host, list)
            return () => {
                const current = handlers.get(host) ?? []
                const index = current.indexOf(handler)
                if (index >= 0) {
                    current.splice(index, 1)
                }
                handlers.set(host, current)
            }
        },
        request(host: Host, detail: ContextRequestDetail): void {
            requests += 1
            let current: Host | null = host
            while (current !== null) {
                ;(detail as ContextRequestDetail & Record<symbol, unknown>)[contextRequestSource] =
                    current
                for (const handler of handlers.get(current) ?? []) {
                    handler(detail)
                }
                current = current.parent
            }
        },
        announce(host: Host, type: 'mount' | 'dispose', _token: string | null): void {
            if (type === 'mount') {
                mounts += 1
            } else {
                disposals += 1
            }
            for (const listener of [...providerListeners]) {
                listener()
            }
        },
        onProviderChange(listener: () => void): () => void {
            providerListeners.add(listener)
            return () => {
                providerListeners.delete(listener)
            }
        },
        requestCount: () => requests,
        mountAnnouncementCount: () => mounts,
        disposeAnnouncementCount: () => disposals,
    }

    const tokens: TokensPort = {
        read(host: Host): string | null {
            return keys.get(host) ?? null
        },
        write(host: Host, token: string): void {
            keys.set(host, token)
        },
        remove(host: Host, token: string): void {
            if (keys.get(host) === token) {
                keys.delete(host)
            }
        },
    }

    const adapter: FakeHostAdapter = {
        clock,
        scope,
        connectivity,
        tokens,
        scheduler: clock,
        normalize(target: unknown): Host {
            if (typeof target !== 'object' || target === null || !('kind' in target)) {
                throw new DocumentContextError(
                    'HOST_INVALID',
                    'The fake host adapter only accepts fake hosts.',
                )
            }
            const host = target as Host
            if (!states.has(host)) {
                states.set(host, true)
            }
            return host
        },
        createHost(kind: 'element' | 'server' = 'element'): FakeHost {
            const host = createFakeHost(kind)
            const move = host.setParent.bind(host)
            host.setParent = (next: Host | null): void => {
                move(next)
                for (const listener of [...(structureListeners.get(host) ?? [])]) {
                    listener()
                }
            }
            states.set(host, true)
            return host
        },
        setConnected,
        adopt,
    }

    return adapter
}
