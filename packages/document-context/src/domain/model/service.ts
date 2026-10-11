/**
 * Service registration model and a pure execution-guard registry.
 *
 * This module is pure: no DOM access, no timers, no I/O. It runs in a plain
 * Node environment. The registry stores registrations and guards resolution
 * execution (sync re-entry detection, async in-flight coalescing, rejection
 * eviction); it never calls user factories itself. Callers run factories
 * through the `invoke` callbacks they supply, which is where the real session
 * is passed in and where lifecycle caching policies live.
 */
import { DocumentContextError } from './errors.js'
import type { Token } from './token.js'

/**
 * Service scope classification: `singleton` (one instance per Document,
 * first registration wins), `scoped` (cached per Session subtree), or
 * `transient` (a fresh instance per call). This is a static classification;
 * only resolution migrates (`Idle` to `InFlight` to `Resolved`).
 */
export type ServiceLifecycle = 'singleton' | 'scoped' | 'transient'

/**
 * Registration of one service factory under a token, exactly as declared by
 * blueprint operators. Defaults (`scoped`, non-multi, lazy) are applied by
 * the operators, not here.
 *
 * The `session` parameter is deliberately typed `unknown` to avoid a domain
 * import cycle: usecases invoke the factory with the real `Session`.
 */
export interface ServiceRegistration<T = unknown> {
    /** Token the factory provides; string equality across bundles and realms. */
    readonly token: Token
    /**
     * Factory producing the service; invoked with the real session by
     * usecases through the registry `invoke` callbacks, never by `register`.
     */
    readonly factory: (session: unknown) => T | Promise<T>
    /** Scope classification of the produced service. */
    readonly lifecycle: ServiceLifecycle
    /** True when the factory may resolve asynchronously. */
    readonly async: boolean
    /** True when the registration accumulates for `injectAll` instead of overwriting. */
    readonly multi: boolean
    /** True when the service instantiates during mount before `onMount`. */
    readonly eager: boolean
}

/**
 * Outcome of `register`: `added` for a first single registration,
 * `overwritten` when a single registration replaces a previous single one,
 * `multi-added` for every accumulating multi registration, and
 * `singleton-kept` when a singleton conflict keeps the first registration
 * (the caller routes `SINGLETON_CONFLICT` to the losing session's `errors$`).
 */
export type ServiceRegisterResult = 'added' | 'overwritten' | 'multi-added' | 'singleton-kept'

/**
 * Pure registry handle created by `createServiceRegistry`. Registrations are
 * keyed by token identity (string value equality; private-token reference
 * equality). `size` counts distinct keys holding any registration.
 */
export interface ServiceRegistryHandle {
    /**
     * Stores a registration without executing its factory.
     *
     * @param reg The registration to store.
     * @returns How the registration was absorbed.
     */
    register(reg: ServiceRegistration): ServiceRegisterResult
    /**
     * Runs a synchronous resolution under a re-entry guard: re-entering the
     * same key synchronously throws `CIRCULAR_DEPENDENCY`.
     *
     * @param key Token being resolved; only used as the guard identity.
     * @param invoke Caller callback that runs the factory and returns its value.
     * @returns Whatever `invoke` returned.
     * @throws DocumentContextError with code `CIRCULAR_DEPENDENCY` on same-key sync re-entry.
     */
    resolveSync(key: Token, invoke: () => unknown): unknown
    /**
     * Runs an asynchronous resolution with in-flight coalescing: concurrent
     * calls for the same key share one promise and invoke once. Resolved
     * promises are retained for coalescing (transient callers must `evict` or
     * bypass); rejected promises are evicted immediately so retries re-invoke.
     * Await-crossed re-entry coalesces onto the in-flight promise (which then
     * deadlocks until the caller's `timeoutMs`, per the service machine);
     * sync-immediate re-entry has no promise to wait on and rejects with
     * `CIRCULAR_DEPENDENCY`. This function never throws synchronously for
     * invoke failures; they surface as rejections.
     *
     * @param key Token being resolved; only used as the coalescing identity.
     * @param invoke Caller callback that runs the factory and returns its value or promise.
     * @returns The shared promise for this key.
     */
    resolveAsync(key: Token, invoke: () => unknown | Promise<unknown>): Promise<unknown>
    /**
     * Drops every registration and in-flight entry for a key. Already handed
     * out promises still settle but no longer coalesce.
     *
     * @param key Token to forget entirely.
     */
    evict(key: Token): void
    /**
     * Counts distinct keys holding any registration.
     *
     * @returns The number of keys with a single or multi registration.
     */
    size(): number
}

/**
 * Creates an isolated service registry. Pure factory: no DOM, no timers, no
 * shared globals; every call yields an independent registry with empty maps.
 *
 * @returns The new registry handle.
 * @example
 * ```ts
 * import { createServiceRegistry } from './service.js'
 *
 * const registry = createServiceRegistry()
 * registry.register({
 *     token: 'app:user',
 *     factory: () => ({ id: 'u1' }),
 *     lifecycle: 'scoped',
 *     async: false,
 *     multi: false,
 *     eager: false,
 * })
 * const user = registry.resolveSync('app:user', () => ({ id: 'u1' }))
 * console.log(user)
 * ```
 */
export function createServiceRegistry(): ServiceRegistryHandle {
    const singles = new Map<Token, ServiceRegistration>()
    const multis = new Map<Token, Array<ServiceRegistration>>()
    const inflight = new Map<Token, Promise<unknown>>()
    const active = new Set<Token>()

    return {
        register(reg: ServiceRegistration): ServiceRegisterResult {
            if (reg.multi) {
                const list = multis.get(reg.token)
                if (list === undefined) {
                    multis.set(reg.token, [reg])
                } else {
                    list.push(reg)
                }
                return 'multi-added'
            }
            const existing = singles.get(reg.token)
            if (existing === undefined) {
                singles.set(reg.token, reg)
                return 'added'
            }
            if (existing.lifecycle === 'singleton' || reg.lifecycle === 'singleton') {
                return 'singleton-kept'
            }
            singles.set(reg.token, reg)
            return 'overwritten'
        },
        resolveSync(key: Token, invoke: () => unknown): unknown {
            if (active.has(key)) {
                throw new DocumentContextError('CIRCULAR_DEPENDENCY', { token: key })
            }
            active.add(key)
            try {
                return invoke()
            } finally {
                active.delete(key)
            }
        },
        resolveAsync(key: Token, invoke: () => unknown | Promise<unknown>): Promise<unknown> {
            const pending = inflight.get(key)
            if (pending !== undefined) {
                return pending
            }
            if (active.has(key)) {
                throw new DocumentContextError('CIRCULAR_DEPENDENCY', { token: key })
            }
            active.add(key)
            let produced: unknown | Promise<unknown>
            try {
                produced = invoke()
            } catch (error) {
                active.delete(key)
                return Promise.reject(error)
            }
            active.delete(key)
            const promise = Promise.resolve(produced)
            inflight.set(key, promise)
            promise.then(undefined, () => {
                if (inflight.get(key) === promise) {
                    inflight.delete(key)
                }
            })
            return promise
        },
        evict(key: Token): void {
            singles.delete(key)
            multis.delete(key)
            inflight.delete(key)
        },
        size(): number {
            const keys = new Set<Token>()
            for (const key of singles.keys()) {
                keys.add(key)
            }
            for (const key of multis.keys()) {
                keys.add(key)
            }
            return keys.size
        },
    }
}
