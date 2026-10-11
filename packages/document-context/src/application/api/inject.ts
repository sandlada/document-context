/**
 * Application injection verbs: async-first late binding over the scope
 * transport plus second-tier synchronous projections over mounted sessions.
 *
 * Phase: runtime (application layer). The curried factories are pure: calling
 * `createInjection` performs no I/O, installs no listeners, and touches no
 * timers. Every verb is data-last and curried. Async verbs are cold until
 * subscribed (Observable) or invoked (Promise); sync verbs resolve
 * immediately against already-mounted sessions and never wait.
 *
 * Side effects: async verbs subscribe to the scope transport only after a
 * walk of already-mounted ancestor sessions finds no local registration;
 * factory invocation runs user code. Idempotency: unsubscribe, `signal`,
 * `timeoutMs`, and target death race first-wins with exactly-once settlement
 * and no residual timers or listeners. Lifecycle: disposed explicit targets
 * settle with `DISPOSED_SESSION`; element targets never observe death.
 *
 * Singleton conflicts discovered at resolve time are winner-first and silent:
 * the first cached instance (per `ctx.singletons`) is returned without
 * throwing. Routing `SINGLETON_CONFLICT` to the losing mount session's
 * `errors$` is owned by the mount track at registration time, not here.
 */

import { Observable } from 'rxjs'
import type { Subscription } from 'rxjs'
import {
    DocumentContextError,
    collectAncestors,
    isThenable,
    orderEntries,
    resolveAllSync,
    resolveSync,
    validateTokenName,
    watchOnce,
} from '../../domain/index.js'
import type {
    HostPort,
    MountSessionRecord,
    PrivateToken,
    SchedulerPort,
    ScopeResolution,
    ScopeTransportPort,
    ServiceRegistration,
    ServiceRegistry,
    ServiceToken,
    Session,
    SyncServiceStore,
    Token,
    WatchOnceInput,
} from '../../domain/index.js'

/**
 * Synchronous injection target: an already-mounted `Session` only. Element
 * and `HostPort` targets are rejected with `UNKNOWN_SERVICE` on this tier.
 */
export type SyncTarget = Session<Record<PropertyKey, unknown>, unknown>

/**
 * Late-binding injection target: a `Session`, a `HostPort`, or a native
 * element, normalised through `toHost`. Mirrors the spec `LateTarget` shape
 * with a Node-safe `Native = unknown` default (no DOM globals here).
 */
export type LateTarget<
    S extends Record<PropertyKey, unknown> = Record<PropertyKey, unknown>,
    Native = unknown,
> = Session<S, Native> | HostPort<Native> | Native

/**
 * Options shared by the single-value async verbs.
 */
export interface InjectOptions {
    /** Consumer cancellation; Observable completes, Promise rejects with `signal.reason`. */
    readonly signal?: AbortSignal
    /** Explicit wait budget; expiry settles with `RESOLUTION_TIMEOUT`. */
    readonly timeoutMs?: number
}

/**
 * Options shared by the multi-value async verbs.
 */
export interface InjectAllOptions {
    /** Multi ordering; `bottomUp` (nearest-first) is the default. */
    readonly direction?: 'bottomUp' | 'topDown'
    /** Consumer cancellation; Observable completes, Promise rejects with `signal.reason`. */
    readonly signal?: AbortSignal
    /** Explicit wait budget; expiry settles with `RESOLUTION_TIMEOUT`. */
    readonly timeoutMs?: number
}

/**
 * Options for the multi-value synchronous projection.
 */
export interface InjectAllSyncOptions {
    /** Multi ordering; `bottomUp` (nearest-first) is the default. */
    readonly direction?: 'bottomUp' | 'topDown'
}

/**
 * Host adapter surface consumed by injection: target normalisation, the
 * deterministic scheduler owning `timeoutMs`, and the scope transport owning
 * late-binding watches. A structural subset of the application ports so a
 * future `ApplicationContext` stays assignable.
 */
export interface InjectionHostAdapter {
    /** Normalises a native element to its `HostPort`; throws `HOST_INVALID` for non-hosts. */
    readonly toHost: (native: unknown) => HostPort<unknown>
    /** Scheduler owning every `timeoutMs` timer; no bare timers are used. */
    readonly scheduler: SchedulerPort
    /** Scope transport owning snapshots and late-binding watches. */
    readonly scopeTransport: ScopeTransportPort
}

/**
 * Ports consumed by injection: the host adapter plus an optional server
 * adapter whose presence enables Session-target fast-reject.
 */
export interface InjectionPorts {
    /** Host adapter for normalisation, scheduling, and transport. */
    readonly host: InjectionHostAdapter
    /** Server adapter marker; when present, true Session-target absences fast-reject. */
    readonly ssr?: unknown
}

/**
 * One mounted session entry keyed by native host.
 */
export interface InjectionSessionEntry {
    /** Stable session facade handed to factories and subscribers. */
    readonly facade: Session<Record<PropertyKey, unknown>, unknown>
    /** Live session record owning state, services, and lifecycle status. */
    readonly record: MountSessionRecord<Record<PropertyKey, unknown>>
}

/**
 * Structural application context consumed by injection. Mirrors the frozen
 * `ApplicationContext` subset this track needs; `../context.js` (parallel
 * track) is intentionally not imported so this module typechecks standalone.
 */
export interface InjectionContext {
    /** Adapter ports. */
    readonly ports: InjectionPorts
    /** Native host to mounted session entries. */
    readonly sessions: ReadonlyMap<unknown, InjectionSessionEntry>
    /** Session facade to live record lookup. */
    readonly records: WeakMap<object, MountSessionRecord<Record<PropertyKey, unknown>>>
    /** Per-document singleton cache: first registration wins, rejections evicted. */
    readonly singletons: Map<unknown, unknown>
}

/**
 * Single-value late-binding stream.
 *
 * Phase: runtime; cold until subscribed. Purity: subscribing walks mounted
 * sessions, then the scope transport; user factories run on a hit. Side
 * effects: a transport watch only while pending. Idempotency: first
 * settlement wins exactly once. Lifecycle: target-session death errors with
 * `DISPOSED_SESSION`.
 *
 * @param token Service token under the four overload strategies.
 * @param options Optional `timeoutMs` and `signal`.
 * @returns Cold resolve-once Observable of the nearest service value.
 */
export interface InjectObservableFn {
    /** ServiceRegistry declaration-merging overload (string literal ergonomics). */
    <K extends keyof ServiceRegistry>(
        token: K,
        options?: InjectOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Observable<ServiceRegistry[K]>
    /** Explicit branded token overload. */
    <T>(
        token: ServiceToken<T>,
        options?: InjectOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Observable<T>
    /** Private token overload (exempt from namespace validation). */
    <T>(
        token: PrivateToken<T>,
        options?: InjectOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Observable<T>
    /** Bare-string escape hatch overload (returns unknown, still validated). */
    (
        token: string,
        options?: InjectOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Observable<unknown>
}

/**
 * Multi-value late-binding stream.
 *
 * Phase: runtime; cold until subscribed. Purity: subscribing collects mounted
 * multi registrations, else watches the transport. Side effects: a transport
 * watch only while pending. Idempotency: first non-empty snapshot wins
 * exactly once; empty snapshots never settle. Lifecycle: target-session death
 * errors with `DISPOSED_SESSION`.
 *
 * @param token Service token under the four overload strategies.
 * @param options Optional `direction`, `timeoutMs`, and `signal`.
 * @returns Cold Observable of the ordered multi snapshot.
 */
export interface InjectAllObservableFn {
    /** ServiceRegistry declaration-merging overload (string literal ergonomics). */
    <K extends keyof ServiceRegistry>(
        token: K,
        options?: InjectAllOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Observable<ReadonlyArray<ServiceRegistry[K]>>
    /** Explicit branded token overload. */
    <T>(
        token: ServiceToken<T>,
        options?: InjectAllOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Observable<ReadonlyArray<T>>
    /** Private token overload (exempt from namespace validation). */
    <T>(
        token: PrivateToken<T>,
        options?: InjectAllOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Observable<ReadonlyArray<T>>
    /** Bare-string escape hatch overload (returns unknown items, still validated). */
    (
        token: string,
        options?: InjectAllOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Observable<ReadonlyArray<unknown>>
}

/**
 * Single-value waiting Promise.
 *
 * Phase: runtime; starts on call. Purity: identical pipeline to the stream
 * face, converted to a Promise. Side effects: as the stream face.
 * Idempotency: first settlement wins exactly once. Lifecycle: abort rejects
 * with `signal.reason`; target-session death rejects with `DISPOSED_SESSION`.
 *
 * @param token Service token under the four overload strategies.
 * @param options Optional `signal` and `timeoutMs` (default: unbounded wait).
 * @returns Promise of the nearest service value.
 */
export interface InjectFn {
    /** ServiceRegistry declaration-merging overload (string literal ergonomics). */
    <K extends keyof ServiceRegistry>(
        token: K,
        options?: InjectOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Promise<ServiceRegistry[K]>
    /** Explicit branded token overload. */
    <T>(
        token: ServiceToken<T>,
        options?: InjectOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Promise<T>
    /** Private token overload (exempt from namespace validation). */
    <T>(
        token: PrivateToken<T>,
        options?: InjectOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Promise<T>
    /** Bare-string escape hatch overload (returns unknown, still validated). */
    (
        token: string,
        options?: InjectOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Promise<unknown>
}

/**
 * Multi-value waiting Promise.
 *
 * Phase: runtime; starts on call. Purity: identical pipeline to the multi
 * stream face, converted to a Promise. Side effects: as the stream face.
 * Idempotency: first non-empty snapshot wins exactly once. Lifecycle: abort
 * rejects with `signal.reason`; target-session death rejects with
 * `DISPOSED_SESSION`.
 *
 * @param token Service token under the four overload strategies.
 * @param options Optional `direction`, `signal`, and `timeoutMs`.
 * @returns Promise of the ordered multi snapshot.
 */
export interface InjectAllFn {
    /** ServiceRegistry declaration-merging overload (string literal ergonomics). */
    <K extends keyof ServiceRegistry>(
        token: K,
        options?: InjectAllOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Promise<ReadonlyArray<ServiceRegistry[K]>>
    /** Explicit branded token overload. */
    <T>(
        token: ServiceToken<T>,
        options?: InjectAllOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Promise<ReadonlyArray<T>>
    /** Private token overload (exempt from namespace validation). */
    <T>(
        token: PrivateToken<T>,
        options?: InjectAllOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Promise<ReadonlyArray<T>>
    /** Bare-string escape hatch overload (returns unknown items, still validated). */
    (
        token: string,
        options?: InjectAllOptions,
    ): (target: LateTarget<Record<PropertyKey, unknown>, unknown>) => Promise<ReadonlyArray<unknown>>
}

/**
 * Single-value synchronous projection (second tier).
 *
 * Phase: runtime snapshot; Session targets only. Purity: pure read plus user
 * factory execution under the domain re-entry guard. Side effects: none
 * beyond the factory itself. Idempotency: repeated calls re-resolve.
 * Lifecycle: mounted and suspended sessions resolve; disposed targets throw
 * `DISPOSED_SESSION`.
 *
 * @param token Service token under the four overload strategies.
 * @returns Synchronous reader of the nearest service value.
 * @deprecated Second-tier projection: not part of the stable contract and
 * subject to removal. Prefer `inject` / `inject$` for new code.
 */
export interface InjectSyncFn {
    /** ServiceRegistry declaration-merging overload (string literal ergonomics). */
    <K extends keyof ServiceRegistry>(token: K): (session: SyncTarget) => ServiceRegistry[K]
    /** Explicit branded token overload. */
    <T>(token: ServiceToken<T>): (session: SyncTarget) => T
    /** Private token overload (exempt from namespace validation). */
    <T>(token: PrivateToken<T>): (session: SyncTarget) => T
    /** Bare-string escape hatch overload (returns unknown, still validated). */
    (token: string): (session: SyncTarget) => unknown
}

/**
 * Multi-value synchronous projection (second tier).
 *
 * Phase: runtime snapshot; Session targets only. Purity: pure collection
 * plus user factory execution; any unready entry fails the whole fetch.
 * Side effects: none beyond the factories. Idempotency: repeated calls
 * re-collect. Lifecycle: mounted and suspended sessions resolve; disposed
 * targets throw `DISPOSED_SESSION`.
 *
 * @param token Service token.
 * @param options Optional `direction`.
 * @returns Synchronous reader of the ordered multi snapshot (possibly empty).
 * @deprecated Second-tier projection: not part of the stable contract and
 * subject to removal. Prefer `injectAll` / `injectAll$` for new code.
 */
export interface InjectAllSyncFn {
    /** ServiceRegistry declaration-merging overload (string literal ergonomics). */
    <K extends keyof ServiceRegistry>(
        token: K,
        options?: InjectAllSyncOptions,
    ): (session: SyncTarget) => ReadonlyArray<ServiceRegistry[K]>
    /** Explicit branded token overload. */
    <T>(
        token: ServiceToken<T>,
        options?: InjectAllSyncOptions,
    ): (session: SyncTarget) => ReadonlyArray<T>
    /** Private token overload (exempt from namespace validation). */
    <T>(
        token: PrivateToken<T>,
        options?: InjectAllSyncOptions,
    ): (session: SyncTarget) => ReadonlyArray<T>
    /** Bare-string escape hatch overload (returns unknown items, still validated). */
    (
        token: string,
        options?: InjectAllSyncOptions,
    ): (session: SyncTarget) => ReadonlyArray<unknown>
}

/**
 * The six injection verbs created by {@link createInjection}.
 */
export interface Injection {
    /** Waiting Promise face (first tier). */
    readonly inject: InjectFn
    /** Cold resolve-once stream face (first tier). */
    readonly inject$: InjectObservableFn
    /** Multi waiting Promise face (first tier). */
    readonly injectAll: InjectAllFn
    /** Multi cold stream face (first tier). */
    readonly injectAll$: InjectAllObservableFn
    /**
     * Synchronous single projection (second tier).
     *
     * @deprecated Not part of the stable contract; prefer `inject` / `inject$`.
     */
    readonly injectSync: InjectSyncFn
    /**
     * Synchronous multi projection (second tier).
     *
     * @deprecated Not part of the stable contract; prefer `injectAll` / `injectAll$`.
     */
    readonly injectAllSync: InjectAllSyncFn
}

type AnySession = Session<Record<PropertyKey, unknown>, unknown>
type AnyRecord = MountSessionRecord<Record<PropertyKey, unknown>>

interface NormalizedTarget {
    readonly origin: HostPort<unknown>
    readonly session: AnySession | null
    readonly record: AnyRecord | null
}

interface WalkEntry {
    readonly host: HostPort<unknown>
    readonly depth: number
    readonly facade: AnySession
    readonly record: AnyRecord
    readonly store: SyncServiceStore
}

interface SingleHit {
    readonly entry: WalkEntry
    readonly reg: ServiceRegistration
}

interface MultiItem {
    readonly token: Token
    readonly reg: ServiceRegistration
    readonly facade: AnySession
    readonly store: SyncServiceStore
    readonly depth: number
    readonly order: number
}

/**
 * Validates string token forms through the shared namespace validator;
 * private-token objects are exempt. Non-string, non-object tokens fail.
 *
 * @param token Candidate token in any of the four strategy forms.
 * @returns Nothing on success.
 * @throws DocumentContextError with code `TOKEN_INVALID` on any violation.
 * @example
 * ```ts
 * import { validateTokenName } from '../../domain/index.js'
 *
 * validateTokenName('app:user')
 * ```
 */
const validatePublicToken = (token: Token): void => {
    if (typeof token === 'string') {
        validateTokenName(token)
        return
    }
    if (typeof token === 'object' && token !== null) {
        return
    }
    throw new DocumentContextError('TOKEN_INVALID', { token, reason: 'not-a-string' })
}

/**
 * Reports whether a target quacks like a Session facade (carries `state$`
 * and `host`, unlike hosts and natives).
 *
 * @param target Candidate late-binding target.
 * @returns True for Session-shaped targets.
 * @example
 * ```ts
 * const kind = 'state$' in (target as object) ? 'session' : 'other'
 * console.log(kind)
 * ```
 */
const isSessionLike = (target: unknown): target is AnySession => {
    if (typeof target !== 'object' || target === null) {
        return false
    }
    return 'state$' in target && 'host' in target
}

/**
 * Reports whether a target quacks like a HostPort (callable `native` plus a
 * `parent` link, unlike sessions and natives).
 *
 * @param target Candidate late-binding target.
 * @returns True for HostPort-shaped targets.
 * @example
 * ```ts
 * const kind = typeof (target as { native?: unknown }).native === 'function' ? 'host' : 'other'
 * console.log(kind)
 * ```
 */
const isHostLike = (target: unknown): target is HostPort<unknown> => {
    if (typeof target !== 'object' || target === null) {
        return false
    }
    const candidate = target as { readonly native?: unknown }
    return typeof candidate.native === 'function' && 'parent' in target
}

/**
 * Normalises a late target to its origin host plus the explicit session
 * record when the target is a known Session facade.
 *
 * @param ctx Injection context owning the records map and host adapter.
 * @param target Late target in any of the three accepted shapes.
 * @returns Origin host with the optional explicit session and record.
 * @throws DocumentContextError with code `DISPOSED_SESSION` for unknown
 * Session handles, or `HOST_INVALID` (from `toHost`) for non-host natives.
 * @example
 * ```ts
 * const normalized = normalizeTarget(ctx, element)
 * console.log(normalized.origin.isConnected)
 * ```
 */
const normalizeTarget = (ctx: InjectionContext, target: unknown): NormalizedTarget => {
    if (isSessionLike(target)) {
        const record = ctx.records.get(target)
        if (record === undefined) {
            throw new DocumentContextError('DISPOSED_SESSION', {})
        }
        return { origin: record.host as HostPort<unknown>, session: target, record }
    }
    if (isHostLike(target)) {
        return { origin: target, session: null, record: null }
    }
    const host = ctx.ports.host.toHost(target)
    return { origin: host, session: null, record: null }
}

/**
 * Derives a domain sync store for a record. Accepts the mount track's
 * extended record shape (`singles` / `multis` indexes alongside the
 * registry) as well as a `SyncServiceStore`-shaped `services` field;
 * otherwise returns null so async callers fall through to the transport.
 *
 * @param record Live session record, possibly carrying a service index.
 * @returns Domain sync store, or null when the record carries no index.
 * @example
 * ```ts
 * const store = toSyncStore(record)
 * console.log(store === null)
 * ```
 */
const toSyncStore = (record: AnyRecord): SyncServiceStore | null => {
    const isDisposed = record.status === 'disposed'
    const services = record.services as unknown as Partial<SyncServiceStore>
    if (services.singles instanceof Map && services.multis instanceof Map) {
        const registry = services.registry
        if (
            registry !== undefined &&
            typeof registry.resolveSync === 'function' &&
            typeof registry.resolveAsync === 'function'
        ) {
            return { singles: services.singles, multis: services.multis, registry, isDisposed }
        }
        return null
    }
    const extended = record as unknown as { readonly singles?: unknown, readonly multis?: unknown }
    if (extended.singles instanceof Map && extended.multis instanceof Map) {
        return {
            singles: extended.singles as ReadonlyMap<Token, ServiceRegistration>,
            multis: extended.multis as ReadonlyMap<Token, ReadonlyArray<ServiceRegistration>>,
            registry: record.services,
            isDisposed,
        }
    }
    return null
}

/**
 * Walks the ancestor chain from the normalised origin, collecting live
 * session entries nearest-first. The explicit session target always leads at
 * depth zero (even when unmapped, e.g. while suspended); disposed records
 * never answer; element targets additionally require mounted status.
 *
 * @param ctx Injection context owning the sessions map.
 * @param normalized Normalised target with origin, session, and record.
 * @param elementBlind True for element targets (only mounted answers).
 * @returns Nearest-first session entries carrying sync stores.
 * @example
 * ```ts
 * const chain = buildChain(ctx, normalized, true)
 * console.log(chain.length)
 * ```
 */
const buildChain = (
    ctx: InjectionContext,
    normalized: NormalizedTarget,
    elementBlind: boolean,
): Array<WalkEntry> => {
    const chain: Array<WalkEntry> = []
    const pushRecord = (
        host: HostPort<unknown>,
        depth: number,
        facade: AnySession,
        record: AnyRecord,
    ): void => {
        if (record.status === 'disposed') {
            return
        }
        const store = toSyncStore(record)
        if (store === null || store.isDisposed) {
            return
        }
        chain.push({ host, depth, facade, record, store })
    }
    const ancestors = collectAncestors(normalized.origin)
    for (let index = 0; index < ancestors.length; index += 1) {
        const host = ancestors[index]
        if (host === undefined) {
            continue
        }
        const entry = ctx.sessions.get(host.native())
        if (entry === undefined) {
            if (index === 0 && normalized.record !== null && normalized.session !== null) {
                pushRecord(host, index, normalized.session, normalized.record)
            }
            continue
        }
        if (normalized.record !== null && entry.record === normalized.record && normalized.session !== null) {
            pushRecord(host, index, normalized.session, entry.record)
            continue
        }
        if (elementBlind && entry.record.status !== 'mounted') {
            continue
        }
        pushRecord(host, index, entry.facade, entry.record)
    }
    return chain
}

/**
 * Finds the nearest single registration for a token along a walked chain.
 *
 * @param chain Nearest-first session entries.
 * @param token Token to resolve.
 * @returns The winning entry and registration, or null when absent.
 * @example
 * ```ts
 * const hit = findSingle(chain, 'app:user')
 * console.log(hit === null)
 * ```
 */
const findSingle = (chain: ReadonlyArray<WalkEntry>, token: Token): SingleHit | null => {
    for (const entry of chain) {
        const reg = entry.store.singles.get(token)
        if (reg !== undefined) {
            return { entry, reg }
        }
    }
    return null
}

/**
 * Collects every multi registration for a token along a walked chain,
 * carrying depth and per-scope order for later ordering.
 *
 * @param chain Nearest-first session entries.
 * @param token Token to resolve.
 * @returns Multi items in walk order (possibly empty).
 * @example
 * ```ts
 * const items = collectMulti(chain, 'app:tag')
 * console.log(items.length)
 * ```
 */
const collectMulti = (chain: ReadonlyArray<WalkEntry>, token: Token): Array<MultiItem> => {
    const items: Array<MultiItem> = []
    for (const entry of chain) {
        const regs = entry.store.multis.get(token) ?? []
        let order = 0
        for (const reg of regs) {
            items.push({ token, reg, facade: entry.facade, store: entry.store, depth: entry.depth, order })
            order += 1
        }
    }
    return items
}

/**
 * Races a task against the scheduler-owned timeout. The timer is cancelled
 * on settlement, leaving no residual timers; the underlying task is not
 * cancellable and may settle later unobserved.
 *
 * @param task Promise performing the resolution work.
 * @param scheduler Scheduler owning the timeout timer.
 * @param timeoutMs Budget in milliseconds, or undefined for no bound.
 * @param token Token carried in the `RESOLUTION_TIMEOUT` details.
 * @returns The task value, or a `RESOLUTION_TIMEOUT` rejection on expiry.
 * @example
 * ```ts
 * const value = await runWithTimeout(task, scheduler, 10, 'app:user')
 * console.log(value)
 * ```
 */
const runWithTimeout = <T>(
    task: Promise<T>,
    scheduler: SchedulerPort,
    timeoutMs: number | undefined,
    token: Token,
): Promise<T> => {
    if (timeoutMs === undefined) {
        return task
    }
    let cancelTimer = (): void => {}
    const timer = new Promise<never>((_resolve, reject) => {
        cancelTimer = scheduler.timeout(() => {
            reject(new DocumentContextError('RESOLUTION_TIMEOUT', { token, timeoutMs }))
        }, timeoutMs)
    })
    return Promise.race([task, timer]).then(
        (value) => {
            cancelTimer()
            return value
        },
        (error: unknown) => {
            cancelTimer()
            throw error
        },
    )
}

/**
 * Unwraps one application singleton slot. The shared `ApplicationContext`
 * stores `SingletonEntry` records (`{ status: 'resolved', value }` once
 * ready, `{ status: 'inflight', promise }` while warming, or an unresolved
 * claim marker with `value: undefined`), while standalone injection tests
 * store raw values or promises. Both shapes resolve to the service value or
 * its promise; an unresolved marker reports absent so the caller falls
 * through to registry resolution instead of returning the marker itself.
 *
 * @param cached Raw slot content from the singleton map.
 * @returns The service value or promise plus whether a usable slot was found.
 * @example
 * ```ts
 * const hit = unwrapSingletonSlot(ctx.singletons.get('app:theme'))
 * const value = hit.found ? await hit.value : await startFresh()
 * ```
 */
const unwrapSingletonSlot = (cached: unknown): { readonly found: boolean, readonly value?: unknown } => {
    if (typeof cached === 'object' && cached !== null) {
        const slot = cached as { readonly status?: unknown, readonly value?: unknown, readonly promise?: unknown }
        if (slot.status === 'resolved') {
            if (slot.value !== undefined) {
                return { found: true, value: slot.value }
            }
            return { found: false }
        }
        if (slot.status === 'inflight' && slot.promise !== undefined) {
            return { found: true, value: slot.promise }
        }
    }
    if (cached !== undefined) {
        return { found: true, value: cached }
    }
    return { found: false }
}

/**
 * Starts a single registration honouring its lifecycle, invoking the factory
 * synchronously so already-mounted hits settle without a microtask hop:
 * singletons resolve through the first-wins document cache (in-flight
 * coalesced, rejections evicted for self-healing retries), transients always
 * run fresh, and scoped services coalesce through the owning session
 * registry. Synchronous factory throws surface as rejections, never as
 * synchronous throws.
 *
 * @param ctx Injection context owning the singleton cache.
 * @param hit Winning entry and registration.
 * @param token Token carried for coalescing identity.
 * @returns The resolved service value or its promise.
 * @example
 * ```ts
 * const produced = startSingle(ctx, hit, 'app:user')
 * const value = await produced
 * console.log(value)
 * ```
 */
const startSingle = (
    ctx: InjectionContext,
    hit: SingleHit,
    token: Token,
): unknown => {
    const { entry, reg } = hit
    if (reg.lifecycle === 'singleton') {
        if (ctx.singletons.has(token)) {
            const slot = unwrapSingletonSlot(ctx.singletons.get(token))
            if (slot.found) {
                return slot.value
            }
        }
        let pending: Promise<unknown>
        try {
            pending = entry.store.registry.resolveAsync(token, () => reg.factory(entry.facade))
        } catch (error) {
            return Promise.reject(error)
        }
        ctx.singletons.set(token, pending)
        return pending.then(
            (value) => {
                ctx.singletons.set(token, value)
                return value
            },
            (error: unknown) => {
                if (ctx.singletons.get(token) === pending) {
                    ctx.singletons.delete(token)
                }
                throw error
            },
        )
    }
    if (reg.lifecycle === 'transient') {
        try {
            return reg.factory(entry.facade)
        } catch (error) {
            return Promise.reject(error)
        }
    }
    try {
        return entry.store.registry.resolveAsync(token, () => reg.factory(entry.facade))
    } catch (error) {
        return Promise.reject(error)
    }
}

/**
 * Starts one multi item honouring its lifecycle (transients run fresh,
 * everything else coalesces through the owning session registry),
 * synchronously where the primitive allows. Synchronous factory throws
 * surface as rejections, never as synchronous throws.
 *
 * @param item Multi item carrying registration, facade, and store.
 * @returns The resolved value or its promise.
 * @example
 * ```ts
 * const produced = startMultiItem(item)
 * const value = await produced
 * console.log(value)
 * ```
 */
const startMultiItem = (item: MultiItem): unknown => {
    if (item.reg.lifecycle === 'transient') {
        try {
            return item.reg.factory(item.facade)
        } catch (error) {
            return Promise.reject(error)
        }
    }
    try {
        return item.store.registry.resolveAsync(item.token, () => item.reg.factory(item.facade))
    } catch (error) {
        return Promise.reject(error)
    }
}

/**
 * Builds the cold single-value stream: validate, normalise, resolve against
 * mounted sessions, else pend on the scope transport. Exactly-once
 * settlement across hit, transport emission, timeout, abort, and death.
 *
 * @param ctx Injection context.
 * @param token Token to resolve.
 * @param options Optional `signal` and `timeoutMs`.
 * @param target Late target in any accepted shape.
 * @returns Cold resolve-once Observable.
 * @example
 * ```ts
 * buildSingleStream(ctx, 'app:user', undefined, element).subscribe((user) => {
 *     console.log(user)
 * })
 * ```
 */
const buildSingleStream = (
    ctx: InjectionContext,
    token: Token,
    options: InjectOptions | undefined,
    target: unknown,
): Observable<unknown> => new Observable<unknown>((subscriber) => {
    let settled = false
    let inner: Subscription | null = null
    let onAbort: (() => void) | null = null
    const signal = options?.signal
    const timeoutMs = options?.timeoutMs
    const cleanup = (): void => {
        if (onAbort !== null && signal !== undefined) {
            signal.removeEventListener('abort', onAbort)
            onAbort = null
        }
        if (inner !== null) {
            inner.unsubscribe()
            inner = null
        }
    }
    const fail = (error: unknown): void => {
        if (settled) {
            return
        }
        settled = true
        cleanup()
        subscriber.error(error)
    }
    const win = (value: unknown): void => {
        if (settled) {
            return
        }
        settled = true
        cleanup()
        subscriber.next(value)
        subscriber.complete()
    }
    const done = (): void => {
        if (settled) {
            return
        }
        settled = true
        cleanup()
        subscriber.complete()
    }
    try {
        validatePublicToken(token)
        const normalized = normalizeTarget(ctx, target)
        if (normalized.record !== null && normalized.record.status === 'disposed') {
            throw new DocumentContextError('DISPOSED_SESSION', {})
        }
        if (signal?.aborted === true) {
            subscriber.complete()
            return undefined
        }
        if (signal !== undefined) {
            onAbort = (): void => {
                done()
            }
            signal.addEventListener('abort', onAbort, { once: true })
        }
        const scheduler = ctx.ports.host.scheduler
        const transport = ctx.ports.host.scopeTransport
        const chain = buildChain(ctx, normalized, normalized.record === null)
        const hit = findSingle(chain, token)
        if (hit !== null) {
            let produced: unknown
            try {
                produced = startSingle(ctx, hit, token)
            } catch (error) {
                fail(error)
                return (): void => {
                    if (!settled) {
                        settled = true
                    }
                    cleanup()
                }
            }
            if (isThenable(produced)) {
                runWithTimeout(Promise.resolve(produced), scheduler, timeoutMs, token).then(win, fail)
            } else {
                win(produced)
            }
            return (): void => {
                if (!settled) {
                    settled = true
                }
                cleanup()
            }
        }
        if (normalized.record !== null && ctx.ports.ssr !== undefined) {
            throw new DocumentContextError('UNKNOWN_SERVICE', { token })
        }
        const watchInput: WatchOnceInput = {
            transport,
            scheduler,
            token,
            from: normalized.origin,
            multi: false,
            ...(signal !== undefined ? { signal } : {}),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            ...(normalized.record !== null ? { abort$: normalized.record.abort$ } : {}),
        }
        let valuePending = false
        inner = watchOnce<unknown>(watchInput).subscribe({
            next: (resolution) => {
                const single = resolution as ScopeResolution<unknown>
                single.unsubscribe()
                if (isThenable(single.value)) {
                    valuePending = true
                    Promise.resolve(single.value).then(win, fail)
                } else {
                    win(single.value)
                }
            },
            error: fail,
            complete: () => {
                if (!valuePending) {
                    done()
                }
            },
        })
    } catch (error) {
        fail(error)
        return undefined
    }
    return (): void => {
        if (!settled) {
            settled = true
        }
        cleanup()
    }
})

/**
 * Builds the cold multi-value stream: validate, normalise, collect mounted
 * multi registrations, else pend for the first non-empty transport snapshot.
 * Exactly-once settlement across snapshot, timeout, abort, and death; empty
 * snapshots never settle.
 *
 * @param ctx Injection context.
 * @param token Token to resolve.
 * @param options Optional `direction`, `signal`, and `timeoutMs`.
 * @param target Late target in any accepted shape.
 * @returns Cold Observable of the ordered multi snapshot.
 * @example
 * ```ts
 * buildMultiStream(ctx, 'app:tag', { direction: 'topDown' }, element).subscribe((tags) => {
 *     console.log(tags)
 * })
 * ```
 */
const buildMultiStream = (
    ctx: InjectionContext,
    token: Token,
    options: InjectAllOptions | undefined,
    target: unknown,
): Observable<ReadonlyArray<unknown>> => new Observable<ReadonlyArray<unknown>>((subscriber) => {
    let settled = false
    let inner: Subscription | null = null
    let onAbort: (() => void) | null = null
    const signal = options?.signal
    const timeoutMs = options?.timeoutMs
    const direction = options?.direction ?? 'bottomUp'
    const cleanup = (): void => {
        if (onAbort !== null && signal !== undefined) {
            signal.removeEventListener('abort', onAbort)
            onAbort = null
        }
        if (inner !== null) {
            inner.unsubscribe()
            inner = null
        }
    }
    const fail = (error: unknown): void => {
        if (settled) {
            return
        }
        settled = true
        cleanup()
        subscriber.error(error)
    }
    const win = (value: ReadonlyArray<unknown>): void => {
        if (settled) {
            return
        }
        settled = true
        cleanup()
        subscriber.next(value)
        subscriber.complete()
    }
    const done = (): void => {
        if (settled) {
            return
        }
        settled = true
        cleanup()
        subscriber.complete()
    }
    try {
        validatePublicToken(token)
        const normalized = normalizeTarget(ctx, target)
        if (normalized.record !== null && normalized.record.status === 'disposed') {
            throw new DocumentContextError('DISPOSED_SESSION', {})
        }
        if (signal?.aborted === true) {
            subscriber.complete()
            return undefined
        }
        if (signal !== undefined) {
            onAbort = (): void => {
                done()
            }
            signal.addEventListener('abort', onAbort, { once: true })
        }
        const scheduler = ctx.ports.host.scheduler
        const transport = ctx.ports.host.scopeTransport
        const chain = buildChain(ctx, normalized, normalized.record === null)
        const items = collectMulti(chain, token)
        if (items.length > 0) {
            const task = Promise.all(items.map(async (item) => ({
                value: await startMultiItem(item),
                depth: item.depth,
                order: item.order,
            }))).then((resolved) => orderEntries(resolved, direction).map((entry) => entry.value))
            runWithTimeout(task, scheduler, timeoutMs, token).then(win, fail)
            return (): void => {
                if (!settled) {
                    settled = true
                }
                cleanup()
            }
        }
        if (normalized.record !== null && ctx.ports.ssr !== undefined) {
            throw new DocumentContextError('UNKNOWN_SERVICE', { token })
        }
        const watchInput: WatchOnceInput = {
            transport,
            scheduler,
            token,
            from: normalized.origin,
            multi: true,
            direction,
            ...(signal !== undefined ? { signal } : {}),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            ...(normalized.record !== null ? { abort$: normalized.record.abort$ } : {}),
        }
        let valuePending = false
        inner = watchOnce<unknown>(watchInput).subscribe({
            next: (snapshot) => {
                const resolutions = snapshot as ReadonlyArray<ScopeResolution<unknown>>
                for (const resolution of resolutions) {
                    resolution.unsubscribe()
                }
                const values = resolutions.map((resolution) => resolution.value)
                if (values.some((value) => isThenable(value))) {
                    valuePending = true
                    Promise.all(values.map((value) => Promise.resolve(value))).then(win, fail)
                } else {
                    win(values as ReadonlyArray<unknown>)
                }
            },
            error: fail,
            complete: () => {
                if (!valuePending) {
                    done()
                }
            },
        })
    } catch (error) {
        fail(error)
        return undefined
    }
    return (): void => {
        if (!settled) {
            settled = true
        }
        cleanup()
    }
})

/**
 * Converts a cold resolve-once stream into the waiting Promise face.
 * Pre-aborted signals reject immediately with `signal.reason` without
 * touching the transport; mid-wait aborts reject the same way; stream
 * completion without emission (third-party empty transport completion)
 * rejects with `UNKNOWN_SERVICE`. Exactly-once settlement.
 *
 * @param stream Cold resolve-once stream to consume.
 * @param token Token carried for the empty-completion fallback error.
 * @param signal Optional consumer cancellation.
 * @returns Promise settling with the first emission or the first terminator.
 * @example
 * ```ts
 * const user = await toPromise(buildSingleStream(ctx, 'app:user', undefined, element), 'app:user', undefined)
 * console.log(user)
 * ```
 */
const toPromise = <T>(
    stream: Observable<T>,
    token: Token,
    signal: AbortSignal | undefined,
): Promise<T> => new Promise<T>((resolve, reject) => {
    let settled = false
    let subscription: Subscription | null = null
    const cleanup = (): void => {
        if (signal !== undefined) {
            signal.removeEventListener('abort', onAbort)
        }
        if (subscription !== null) {
            subscription.unsubscribe()
            subscription = null
        }
    }
    const onAbort = (): void => {
        if (settled) {
            return
        }
        settled = true
        cleanup()
        reject(signal?.reason)
    }
    if (signal !== undefined) {
        signal.addEventListener('abort', onAbort, { once: true })
    }
    subscription = stream.subscribe({
        next: (value) => {
            if (settled) {
                return
            }
            settled = true
            cleanup()
            resolve(value)
        },
        error: (error: unknown) => {
            if (settled) {
                return
            }
            settled = true
            cleanup()
            reject(error)
        },
        complete: () => {
            if (settled) {
                return
            }
            settled = true
            cleanup()
            if (signal?.aborted === true) {
                reject(signal.reason)
            } else {
                reject(new DocumentContextError('UNKNOWN_SERVICE', { token }))
            }
        },
    })
})

/**
 * Creates the six injection verbs bound to one application context.
 *
 * Phase: pure factory (Phase-1 style); no DOM, no I/O, no listeners, no
 * timers. Purity: creating the verbs never resolves anything. Side effects:
 * only the returned verbs cause resolution work, and only when subscribed
 * (streams) or called (Promises / sync). Idempotency: creating twice yields
 * independent verb sets over the same context. Lifecycle: verbs observe
 * records live; disposal is observed per call, never cached.
 *
 * @param ctx Injection context owning ports, sessions, records, and singletons.
 * @returns The six injection verbs `{ inject, inject$, injectAll, injectAll$, injectSync, injectAllSync }`.
 * @example
 * ```ts
 * import { createInjection } from './inject.js'
 *
 * const { inject, injectSync } = createInjection(ctx)
 * const user = await inject('app:user')(element)
 * const cached = injectSync('app:user')(session)
 * ```
 */
export const createInjection = (ctx: InjectionContext): Injection => {
    const inject$ = ((token: Token, options?: InjectOptions) => (target: unknown): Observable<unknown> =>
        buildSingleStream(ctx, token, options, target)) as InjectObservableFn
    const injectAll$ = ((token: Token, options?: InjectAllOptions) => (target: unknown): Observable<ReadonlyArray<unknown>> =>
        buildMultiStream(ctx, token, options, target)) as InjectAllObservableFn
    const inject = ((token: Token, options?: InjectOptions) => (target: unknown): Promise<unknown> =>
        toPromise(buildSingleStream(ctx, token, options, target), token, options?.signal)) as InjectFn
    const injectAll = ((token: Token, options?: InjectAllOptions) => (target: unknown): Promise<ReadonlyArray<unknown>> =>
        toPromise(buildMultiStream(ctx, token, options, target), token, options?.signal)) as InjectAllFn
    const injectSync = ((token: Token) => {
        validatePublicToken(token)
        return (session: unknown): unknown => {
            if (!isSessionLike(session)) {
                throw new DocumentContextError('UNKNOWN_SERVICE', { token })
            }
            const record = ctx.records.get(session)
            if (record === undefined || record.status === 'disposed') {
                throw new DocumentContextError('DISPOSED_SESSION', {})
            }
            const chain = buildChain(ctx, { origin: record.host as HostPort<unknown>, session, record }, false)
            const hit = findSingle(chain, token)
            if (hit === null) {
                throw new DocumentContextError('UNKNOWN_SERVICE', { token })
            }
            return resolveSync({ services: hit.entry.store, token, session: hit.entry.facade })
        }
    }) as InjectSyncFn
    const injectAllSync = ((token: Token, options?: InjectAllSyncOptions) => {
        validatePublicToken(token)
        const direction = options?.direction ?? 'bottomUp'
        return (session: unknown): ReadonlyArray<unknown> => {
            if (!isSessionLike(session)) {
                throw new DocumentContextError('UNKNOWN_SERVICE', { token })
            }
            const record = ctx.records.get(session)
            if (record === undefined || record.status === 'disposed') {
                throw new DocumentContextError('DISPOSED_SESSION', {})
            }
            const chain = buildChain(ctx, { origin: record.host as HostPort<unknown>, session, record }, false)
            const combined: Array<{ readonly value: unknown, readonly depth: number, readonly order: number }> = []
            for (const entry of chain) {
                const values = resolveAllSync({ services: entry.store, token, session: entry.facade })
                let order = 0
                for (const value of values) {
                    combined.push({ value, depth: entry.depth, order })
                    order += 1
                }
            }
            return orderEntries(combined, direction).map((item) => item.value)
        }
    }) as InjectAllSyncFn
    return { inject, inject$, injectAll, injectAll$, injectSync, injectAllSync }
}
