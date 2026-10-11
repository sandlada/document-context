/**
 * Application mount verbs: async `mount` and sync `mountSync` factories.
 *
 * This module owns the mount side of the application layer: host
 * normalization through the injected `HostAdapter`, keyed identity
 * resolution, host-granularity idempotency, cross-host conflict racing,
 * storage and SSR hydration ahead of eager instantiation (hydrate-first),
 * `Session` facade assembly, `onMount` FIFO execution, the one-shot
 * `context-request` responder, disconnect re-checks with keyed TTL, and
 * resuscitation of suspended sessions.
 *
 * Purity and portability rules: no DOM globals (no `document`, `window`,
 * or `CustomEvent`; every host touch flows through ports), no real timers
 * (time flows through `SchedulerPort` only), and only non-time RxJS cores.
 * Runtime imports are limited to the landed domain plus `rxjs`; the
 * application context type enters type-only from `../context.js` (A3) and is
 * erased at runtime.
 */

import { Observable, Subject } from 'rxjs'
import type { Subscription } from 'rxjs'
import { DocumentContextError } from '../../domain/model/errors.js'
import type { ContextBlueprint } from '../../domain/model/blueprint.js'
import type { BlueprintHookEvent } from '../../domain/model/blueprint.js'
import type { HostLifecycleEvent, HostPort } from '../../domain/ports/host.js'
import type { SchedulerPort } from '../../domain/ports/scheduler.js'
import type { StoragePort } from '../../domain/ports/storage.js'
import { isThenable } from '../../domain/ports/scope-transport.js'
import type { Token } from '../../domain/model/token.js'
import { validateTokenName } from '../../domain/model/token.js'
import type { LifecycleEvent, Session } from '../../domain/model/session.js'
import type { ServiceRegistration } from '../../domain/model/service.js'
import { transition } from '../../domain/model/lifecycle.js'
import type { SessionKind } from '../../domain/model/lifecycle.js'
import { collectAncestors } from '../../domain/model/scope.js'
import { mountSession } from '../../domain/usecases/mount.js'
import type { MountSessionRecord } from '../../domain/usecases/mount.js'
import { hydrateState } from '../../domain/usecases/hydrate.js'
import type { HydrateStateResult } from '../../domain/usecases/hydrate.js'
import { resolveSync } from '../../domain/usecases/resolve.js'
import type { SyncServiceStore } from '../../domain/usecases/resolve.js'

import type { ApplicationContext } from '../context.js'

/**
 * Mount options. Every field is optional; unspecified fields take documented defaults.
 *
 * @property token Keyed identity. Validated with the shared token validator; violations throw `TOKEN_INVALID`.
 * @property suspensionTtlMs Keyed suspend time-to-live in milliseconds. Defaults to `50`; `0` disposes immediately; `Infinity` requires `retention: 'pinned'`.
 * @property retention Retention mode. Only `'pinned'` admits an infinite TTL.
 * @property observer Per-mount observer override; mount wins over the application policy. Recorded on the entry; wiring is infra-owned.
 * @property onConflict Same-host swap and key contradiction policy. Defaults to `'throw'`; genuine dual-active always throws.
 * @property ssrPayload SSR payload source. Defaults to `'auto'`; degrades to off without a resolver.
 * @property signal Mount cancellation. Abort discards init and rejects with `signal.reason`; ignored after `Mounted`. `mountSync` never reads it.
 */
export interface MountOptions {
    /** Keyed identity for the session. */
    readonly token?: string
    /** Suspend TTL in milliseconds. */
    readonly suspensionTtlMs?: number
    /** Retention mode for infinite TTL. */
    readonly retention?: 'default' | 'pinned'
    /** Per-mount observer override. */
    readonly observer?: boolean
    /** Identity conflict policy for same-host swaps and key contradictions. */
    readonly onConflict?: 'throw' | 'evict' | 'reset'
    /** SSR payload source. */
    readonly ssrPayload?: 'auto' | 'off'
    /** Mount cancellation signal. */
    readonly signal?: AbortSignal
}

/** Slot sharing live entries with the dispose verb through the global symbol registry. */
const ENTRY_SLOT = Symbol.for('document-context.application.session-entry')

/** In-flight fresh-mount reservation table closing the pre-entry check window. */
interface FreshSlots {
    /** Pending fresh mounts by native key. */
    readonly byNative: Map<object, Promise<unknown>>
    /** Pending fresh mounts by keyed identity. */
    readonly byToken: Map<string, Promise<unknown>>
}

/** In-flight reservation tables by context; entries never outlive their settle. */
const freshSlots = new WeakMap<ApplicationContext, FreshSlots>()

/** Reads the reservation table without creating it. */
const peekSlots = (ctx: ApplicationContext): FreshSlots | undefined => freshSlots.get(ctx)

/** Reads (creating on demand) the reservation table. */
const slotsFor = (ctx: ApplicationContext): FreshSlots => {
    const existing = freshSlots.get(ctx)
    if (existing !== undefined) {
        return existing
    }
    const created: FreshSlots = { byNative: new Map(), byToken: new Map() }
    freshSlots.set(ctx, created)
    return created
}

/** Slot sharing the per-context suspended list with the dispose verb. */
const SUSPENDED_SLOT = Symbol.for('document-context.application.suspended-list')

/** Buffered error channel with drain-once replay semantics. */
interface ErrorChannel {
    /** True while pushes are accepted. */
    readonly open: boolean
    /** Buffers (pre-subscribe, capped at 32) or forwards an error. */
    push(error: DocumentContextError): void
    /** Drain-once observable: first subscriber replays the buffer, later ones see only new errors. */
    errors$(): Observable<DocumentContextError>
    /** Closes the channel; late first subscribers drain the remainder then complete. */
    complete(): void
}

/** Creates an isolated buffered error channel. */
const createErrorChannel = (): ErrorChannel => {
    const buffer: Array<DocumentContextError> = []
    let dropped = 0
    let firstSeen = false
    let completed = false
    const hot = new Subject<DocumentContextError>()
    return {
        get open(): boolean {
            return !completed
        },
        push(error: DocumentContextError): void {
            if (completed) {
                if (typeof globalThis.reportError === 'function') {
                    globalThis.reportError(error)
                }
                return
            }
            if (!firstSeen) {
                if (buffer.length >= 32) {
                    buffer.shift()
                    dropped += 1
                }
                buffer.push(error)
            }
            hot.next(error)
        },
        errors$(): Observable<DocumentContextError> {
            return new Observable<DocumentContextError>((subscriber) => {
                if (!firstSeen) {
                    firstSeen = true
                    const snapshot = [...buffer]
                    buffer.length = 0
                    for (const item of snapshot) {
                        subscriber.next(item)
                    }
                    if (dropped > 0) {
                        const last = snapshot[snapshot.length - 1]
                        if (last !== undefined) {
                            subscriber.next(new DocumentContextError(last.code, { ...last.details, dropped }))
                        }
                    }
                    if (completed) {
                        subscriber.complete()
                        return undefined
                    }
                } else if (completed) {
                    subscriber.complete()
                    return undefined
                }
                const inner = hot.subscribe(subscriber)
                return (): void => {
                    inner.unsubscribe()
                }
            })
        },
        complete(): void {
            if (!completed) {
                completed = true
                hot.complete()
            }
        },
    }
}

/** Live per-session bookkeeping shared with the dispose verb through `ENTRY_SLOT`. */
interface SessionEntry<S extends Record<PropertyKey, unknown>> {
    /** Domain mount record; status is the lifecycle source of truth. */
    record: MountSessionRecord<S>
    /** Mounted blueprint; first blueprint wins on idempotent hits. */
    blueprint: ContextBlueprint<S>
    /** Stable host facade; repointed internally on resuscitation. */
    hostFacade: HostPort
    /** Mutable box holding the currently bound raw host. */
    hostBox: { current: HostPort }
    /** Forwarded host lifecycle stream behind the facade. */
    hostEvents: Subject<HostLifecycleEvent>
    /** Native node the session is currently bound to. */
    native: unknown
    /** Map key for the native node (the node itself, or the host fallback). */
    nativeKey: object
    /** Normalized keyed identity, or null for anonymous sessions. */
    token: string | null
    /** Session identity kind. */
    kind: SessionKind
    /** Buffered non-fatal error channel. */
    channel: ErrorChannel
    /** Session lifecycle stream. */
    lifecycle: Subject<LifecycleEvent>
    /** Assembled public facade. */
    facade: Session
    /** Single-value registrations by token. */
    singles: ReadonlyMap<Token, ServiceRegistration>
    /** Multi registrations by token in registration order. */
    multis: ReadonlyMap<Token, ReadonlyArray<ServiceRegistration>>
    /** Per-session scoped service instances. */
    instances: Map<Token, unknown>
    /** Singleton keys claimed by this mount for conflict routing. */
    claimedSingletons: Set<string>
    /** Claim markers; released when a mount fails before settling. */
    claimMarkers: Map<string, { status: 'resolved', value: unknown } | { status: 'inflight', promise: Promise<unknown> }>
    /** Domain kernel drivers for abort and explicit-init disposal. */
    kernel: {
        /** Aborts a pending init with the reason. */
        abort(reason?: unknown): void
        /** Explicitly disposes the record; inits reject with `DISPOSED_SESSION`. */
        dispose(): void
        /** Parks a keyed init in `Suspended` on waiting-disconnect. */
        notifyDisconnectedDuringInit(): void
    }
    /** Settles when hydration plus eager warming complete. */
    ready: Promise<void>
    /** Warming flag; initializing-equivalent while true (invisible to scope answers). */
    warming: boolean
    /** `context-request` unsubscribe, or null before install and after teardown. */
    offRequest: (() => void) | null
    /** Synchronous `onMount` cleanup closures, consumed LIFO. */
    cleanups: Array<() => unknown>
    /** Host lifecycle subscription, or null after teardown. */
    hostSub: Subscription | null
    /** Facade lifecycle forwarding subscription, or null after teardown. */
    forwardSub: Subscription | null
    /** Pending TTL cancel, or null when none is armed. */
    ttlCancel: (() => void) | null
    /** Resolved suspend TTL in milliseconds. */
    ttlMs: number
    /** Resolved retention mode. */
    retention: 'default' | 'pinned'
    /** Effective observer flag; recorded for infra, behaviorally inert here. */
    observer: boolean
    /** True for SSR nullHost mounts: skips token-attribute write-back/removal. */
    isNullHost: boolean
    /** True between a disconnect event and its microtask re-check. */
    disconnectPending: boolean
    /** Terminal dispose guard making disposal idempotent. */
    disposed: boolean
    /** Count of unsettled fire-and-forget async cleanups. */
    pendingAsync: number
    /** Resolves when every fire-and-forget async cleanup settles. */
    settled: Promise<void>
    /** Resolver for `settled`. */
    resolveSettled: () => void
    /** Scheduler retained for TTL and re-checks. */
    scheduler: SchedulerPort
}

/** Suspended registry slot shared with the dispose verb. */
interface SuspendedSlot {
    /** Suspended facade identity. */
    readonly facade: object
    /** Keyed identity. */
    readonly token: string
    /** Suspension timestamp from `Date.now`. */
    readonly suspendedAt: number
}

/** Duck-typing probe for `HostPort`; never touches DOM globals. */
const isHostPortLike = (value: unknown): value is HostPort => {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const candidate = value as Record<PropertyKey, unknown>
    return typeof candidate['native'] === 'function'
        && typeof candidate['on'] === 'function'
        && typeof candidate['isConnected'] === 'boolean'
        && 'lifecycle$' in candidate
        && 'parent' in candidate
}

/** Map key for a host: its native node, falling back to the host when native is primitive or unavailable (SSR nullHost). */
const keyOf = (host: HostPort): object => {
    let native: unknown
    try {
        native = host.native()
    } catch {
        return host
    }
    if ((typeof native === 'object' && native !== null) || typeof native === 'function') {
        return native
    }
    return host
}

/** Fresh abort probe; a function boundary defeats stale control-flow narrowing. */
const isAborted = (candidate: AbortSignal | undefined): boolean => candidate?.aborted === true

/** Reads the live entry behind a facade, or undefined for foreign sessions. */
const readEntry = <S extends Record<PropertyKey, unknown>>(facade: Session): SessionEntry<S> | undefined => {
    const slot = (facade as unknown as Record<symbol, unknown>)[ENTRY_SLOT]
    if (typeof slot !== 'object' || slot === null) {
        return undefined
    }
    return slot as SessionEntry<S>
}

/** Reads (creating on demand) the per-context suspended list. */
const readSuspended = (ctx: ApplicationContext): Array<SuspendedSlot> => {
    const table = ctx as unknown as Record<symbol, unknown>
    const existing = table[SUSPENDED_SLOT]
    if (Array.isArray(existing)) {
        return existing as Array<SuspendedSlot>
    }
    const created: Array<SuspendedSlot> = []
    table[SUSPENDED_SLOT] = created
    return created
}

/** Configured suspended cap; tests may override through an optional context field. */
const readMaxSuspended = (ctx: ApplicationContext): number => {
    const override = (ctx as unknown as { readonly maxSuspendedPerDocument?: unknown }).maxSuspendedPerDocument
    if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
        return Math.floor(override)
    }
    return 100
}

/** Removes a facade from the suspended list. */
const removeFromSuspended = (ctx: ApplicationContext, facade: Session): void => {
    const list = readSuspended(ctx)
    const index = list.findIndex((slot) => slot.facade === (facade as unknown as object))
    if (index >= 0) {
        list.splice(index, 1)
    }
}

/** Splits blueprint registrations into single and multi maps. Same-token multi registrations within one blueprint collapse last-wins by `Map` identity (the landed `ContextBlueprint` shape); multi collection spans ancestor sessions. */
const splitRegistrations = (blueprint: ContextBlueprint<Record<PropertyKey, unknown>>): {
    singles: Map<Token, ServiceRegistration>
    multis: Map<Token, Array<ServiceRegistration>>
} => {
    const singles = new Map<Token, ServiceRegistration>()
    const multis = new Map<Token, Array<ServiceRegistration>>()
    for (const registration of blueprint.providers.values()) {
        if (registration.multi) {
            const list = multis.get(registration.token)
            if (list === undefined) {
                multis.set(registration.token, [registration])
            } else {
                list.push(registration)
            }
        } else {
            singles.set(registration.token, registration)
        }
    }
    return { singles, multis }
}

/** Extracts a `context-request` detail from a natively dispatched event or a bare detail. */
const readDetail = (event: unknown): {
    readonly token?: unknown
    readonly callback?: unknown
    readonly multi?: unknown
    readonly subscribe?: unknown
} | null => {
    if (typeof event !== 'object' || event === null) {
        return null
    }
    const holder = event as { readonly detail?: unknown }
    const detail: unknown = holder.detail ?? event
    if (typeof detail !== 'object' || detail === null) {
        return null
    }
    return detail as { readonly token?: unknown, readonly callback?: unknown, readonly multi?: unknown, readonly subscribe?: unknown }
}

/** Settles one fire-and-forget async cleanup; completes errors and settlement at zero. */
const settleAsync = (entry: SessionEntry<Record<PropertyKey, unknown>>): void => {
    entry.pendingAsync -= 1
    if (entry.pendingAsync === 0) {
        if (entry.disposed) {
            entry.channel.complete()
        }
        entry.resolveSettled()
    }
}

/** Tracks a fire-and-forget async cleanup; rejections route to errors$ when open else `reportError`. */
const trackAsync = (
    entry: SessionEntry<Record<PropertyKey, unknown>>,
    produced: Promise<unknown>,
    hook: string,
): void => {
    entry.pendingAsync += 1
    produced.then(
        () => {
            settleAsync(entry)
        },
        (error: unknown) => {
            const failure = new DocumentContextError('HOOK_ERROR', { hook, error })
            if (entry.channel.open) {
                entry.channel.push(failure)
            } else if (typeof globalThis.reportError === 'function') {
                globalThis.reportError(failure)
            }
            settleAsync(entry)
        },
    )
}

/**
 * Two-phase dispose shared by every mount fail path, TTL expiry, eviction,
 * and the ERM symbols. Mirrors the `createDispose` verb; keep the two in
 * sync. Idempotent through the entry disposed guard.
 *
 * @param ctx Application context.
 * @param facade Session facade to tear down.
 */
const disposeEntry = (ctx: ApplicationContext, facade: Session): void => {
    const entry = readEntry<Record<PropertyKey, unknown>>(facade)
    if (entry === undefined || entry.disposed) {
        return
    }
    entry.disposed = true
    try {
        entry.kernel.dispose()
    } catch {
        // Kernel guards illegal transitions; application teardown proceeds regardless.
    }
    if (entry.offRequest !== null) {
        entry.offRequest()
        entry.offRequest = null
    }
    if (entry.hostSub !== null) {
        entry.hostSub.unsubscribe()
        entry.hostSub = null
    }
    if (entry.forwardSub !== null) {
        entry.forwardSub.unsubscribe()
        entry.forwardSub = null
    }
    if (entry.ttlCancel !== null) {
        entry.ttlCancel()
        entry.ttlCancel = null
    }
    removeFromSuspended(ctx, facade)
    while (entry.cleanups.length > 0) {
        const cleanup = entry.cleanups.pop()
        if (cleanup === undefined) {
            continue
        }
        try {
            const produced: unknown = cleanup()
            if (isThenable(produced)) {
                trackAsync(entry, Promise.resolve(produced), 'cleanup')
            }
        } catch (error) {
            entry.channel.push(new DocumentContextError('HOOK_ERROR', { hook: 'cleanup', error }))
        }
    }
    const disposers = entry.blueprint.hooks.filter((hook) => hook.event === 'dispose').reverse()
    for (const hook of disposers) {
        try {
            const produced: unknown = (hook.handler as unknown as (session: unknown) => unknown)(facade)
            if (isThenable(produced)) {
                trackAsync(entry, Promise.resolve(produced), 'dispose')
            }
        } catch (error) {
            entry.channel.push(new DocumentContextError('HOOK_ERROR', { hook: 'dispose', error }))
        }
    }
    ctx.sessions.delete(entry.nativeKey)
    if (entry.token !== null && ctx.keyed.get(entry.token) === (facade as Session)) {
        ctx.keyed.delete(entry.token)
    }
    ctx.records.delete(facade as unknown as object)
    if (entry.token !== null && !entry.isNullHost) {
        try {
            if (ctx.ports.host.tokens.read(entry.native) === entry.token) {
                ctx.ports.host.tokens.write(entry.native, null)
            }
        } catch {
            // Identity write-back is best-effort on teardown.
        }
    }
    entry.lifecycle.next({ type: 'disposed' })
    entry.lifecycle.complete()
    if (entry.pendingAsync === 0) {
        entry.channel.complete()
    }
    ctx.settled$.next()
}

/** Releases singleton claim markers owned by a failed mount. */
const releaseMarkers = (ctx: ApplicationContext, entry: SessionEntry<Record<PropertyKey, unknown>>): void => {
    for (const [key, marker] of entry.claimMarkers) {
        if (ctx.singletons.get(key) === marker) {
            ctx.singletons.delete(key)
        }
    }
    entry.claimMarkers.clear()
    entry.claimedSingletons.clear()
}

/** Runs one hook list in order, sandboxing every hook into `HOOK_ERROR`. */
const runHookList = (
    entry: SessionEntry<Record<PropertyKey, unknown>>,
    event: BlueprintHookEvent,
    invoke: (handler: (session: unknown) => unknown) => void,
): void => {
    for (const hook of entry.blueprint.hooks.filter((candidate) => candidate.event === event)) {
        try {
            invoke(hook.handler as unknown as (session: unknown) => unknown)
        } catch (error) {
            entry.channel.push(new DocumentContextError('HOOK_ERROR', { hook: event, error }))
        }
    }
}

/** Finds the live mounted entry behind a host, or undefined. */
const findMountedEntry = (ctx: ApplicationContext, host: HostPort): SessionEntry<Record<PropertyKey, unknown>> | undefined => {
    const found = ctx.sessions.get(keyOf(host))
    if (found === undefined) {
        return undefined
    }
    const entry = readEntry<Record<PropertyKey, unknown>>(found.facade)
    if (entry === undefined || entry.warming || entry.record.status !== 'mounted' || entry.disposed) {
        return undefined
    }
    return entry
}

/** Builds the sync service store view for one entry. */
const storeOf = (entry: SessionEntry<Record<PropertyKey, unknown>>): SyncServiceStore => ({
    singles: entry.singles,
    multis: entry.multis,
    registry: entry.record.services,
    isDisposed: entry.record.status === 'disposed',
})

/** Resolves one locally registered service synchronously with lifecycle caching. */
const instantiateLocal = (
    ctx: ApplicationContext,
    entry: SessionEntry<Record<PropertyKey, unknown>>,
    registration: ServiceRegistration,
): unknown => {
    if (registration.lifecycle === 'scoped' && entry.instances.has(registration.token)) {
        return entry.instances.get(registration.token)
    }
    const produced: unknown = entry.record.services.resolveSync(registration.token, () => {
        return (registration.factory as (session: unknown) => unknown)(entry.facade)
    })
    if (registration.lifecycle === 'scoped' && !isThenable(produced)) {
        entry.instances.set(registration.token, produced)
    }
    return produced
}

/** Single-value scope answer walking ancestors nearest-first; misses stay silent for late binding. */
const resolveSingle = (
    ctx: ApplicationContext,
    from: HostPort,
    token: Token,
): { readonly found: boolean, readonly value?: unknown } => {
    if (typeof token === 'string') {
        const singleton = ctx.singletons.get(token)
        if (singleton !== undefined && singleton.status === 'resolved' && singleton.value !== undefined) {
            return { found: true, value: singleton.value }
        }
    }
    for (const ancestor of collectAncestors(from)) {
        const entry = findMountedEntry(ctx, ancestor)
        if (entry === undefined) {
            continue
        }
        const registration = entry.singles.get(token)
        if (registration === undefined) {
            continue
        }
        try {
            const produced = instantiateLocal(ctx, entry, registration)
            if (isThenable(produced)) {
                continue
            }
            return { found: true, value: produced }
        } catch {
            continue
        }
    }
    return { found: false }
}

/** Multi-value scope answer in bottom-up order; unready entries are skipped one-shot. */
const resolveMulti = (
    ctx: ApplicationContext,
    from: HostPort,
    token: Token,
): Array<unknown> => {
    const values: Array<unknown> = []
    for (const ancestor of collectAncestors(from)) {
        const entry = findMountedEntry(ctx, ancestor)
        if (entry === undefined) {
            continue
        }
        const registrations = entry.multis.get(token) ?? []
        for (const registration of registrations) {
            try {
                const produced = instantiateLocal(ctx, entry, registration)
                if (!isThenable(produced)) {
                    values.push(produced)
                }
            } catch {
                continue
            }
        }
    }
    return values
}

/** Installs the one-shot `context-request` responder on the current host. */
const installResponder = (ctx: ApplicationContext, entry: SessionEntry<Record<PropertyKey, unknown>>): void => {
    const off = entry.hostBox.current.on('context-request', (event: unknown) => {
        const detail = readDetail(event)
        if (detail === null || typeof detail.callback !== 'function') {
            return
        }
        const callback = detail.callback as (value: unknown) => void
        // The subscribe flag is P1-reserved; v0.1.0 always answers one-shot per D-115.
        if (detail.multi === true) {
            const values = resolveMulti(ctx, entry.hostBox.current, detail.token as Token)
            if (values.length > 0) {
                callback(values)
            }
            return
        }
        const hit = resolveSingle(ctx, entry.hostBox.current, detail.token as Token)
        if (hit.found) {
            callback(hit.value)
            const holder = event as { readonly stopPropagation?: unknown }
            if (typeof holder.stopPropagation === 'function') {
                (holder.stopPropagation as () => void).call(event)
            }
        }
    })
    entry.offRequest = off
}

/** Watches one host for waiting-disconnect and post-mount disconnects. */
const watchHost = (ctx: ApplicationContext, entry: SessionEntry<Record<PropertyKey, unknown>>): ((event: HostLifecycleEvent) => void) => {
    return (event: HostLifecycleEvent): void => {
        if (event.type !== 'disconnect' || entry.disposed) {
            return
        }
        if (entry.record.status === 'initializing') {
            entry.kernel.notifyDisconnectedDuringInit()
            return
        }
        if (entry.record.status === 'mounted') {
            scheduleRecheck(ctx, entry)
        }
    }
}

/** Arms the microtask re-check that separates blips from real disconnects. */
const scheduleRecheck = (ctx: ApplicationContext, entry: SessionEntry<Record<PropertyKey, unknown>>): void => {
    entry.disconnectPending = true
    entry.scheduler.microtask(() => {
        entry.disconnectPending = false
        if (entry.disposed) {
            return
        }
        suspendIfDisconnected(ctx, entry)
    })
}

/** Suspends a disconnected keyed session or disposes an anonymous one. */
const suspendIfDisconnected = (ctx: ApplicationContext, entry: SessionEntry<Record<PropertyKey, unknown>>): void => {
    const record = entry.record
    if (record.status !== 'mounted' || entry.hostBox.current.isConnected) {
        return
    }
    if (entry.kind === 'anonymous') {
        disposeEntry(ctx, entry.facade)
        return
    }
    record.status = transition(record.status, 'disconnect', record.kind)
    runHookList(entry, 'suspend', (handler) => {
        handler(entry.facade)
    })
    entry.lifecycle.next({ type: 'suspended' })
    armSuspended(ctx, entry)
}

/** Arms TTL and cap accounting for a suspended entry. */
const armSuspended = (ctx: ApplicationContext, entry: SessionEntry<Record<PropertyKey, unknown>>): void => {
    if (entry.ttlMs === 0) {
        disposeEntry(ctx, entry.facade)
        return
    }
    if (entry.ttlMs !== Infinity) {
        entry.ttlCancel = entry.scheduler.timeout(() => {
            entry.ttlCancel = null
            disposeEntry(ctx, entry.facade)
        }, entry.ttlMs)
    }
    const list = readSuspended(ctx)
    list.push({
        facade: entry.facade as unknown as object,
        token: entry.token as string,
        suspendedAt: Date.now(),
    })
    const max = readMaxSuspended(ctx)
    while (list.length > max) {
        let oldest: SuspendedSlot | null = null
        for (const slot of list) {
            if (oldest === null || slot.suspendedAt < oldest.suspendedAt) {
                oldest = slot
            }
        }
        if (oldest === null) {
            break
        }
        removeFromSuspended(ctx, oldest.facade as Session)
        const victim = readEntry<Record<PropertyKey, unknown>>(oldest.facade as Session)
        if (victim !== undefined) {
            disposeEntry(ctx, victim.facade)
        }
    }
}

/** Instantiates one eager service with singleton ownership and scoped caching. */
const instantiateEager = (
    ctx: ApplicationContext,
    entry: SessionEntry<Record<PropertyKey, unknown>>,
    registration: ServiceRegistration,
): unknown | Promise<unknown> => {
    if (registration.lifecycle === 'singleton' && typeof registration.token === 'string') {
        const key = registration.token
        if (!entry.claimedSingletons.has(key)) {
            return instantiateLocal(ctx, entry, registration)
        }
    }
    if (registration.lifecycle === 'scoped' && entry.instances.has(registration.token)) {
        return entry.instances.get(registration.token)
    }
    const produced: unknown = (registration.factory as (session: unknown) => unknown)(entry.facade)
    if (registration.lifecycle === 'scoped' && !isThenable(produced)) {
        entry.instances.set(registration.token, produced)
    }
    if (registration.lifecycle === 'singleton' && typeof registration.token === 'string' && !isThenable(produced)) {
        ctx.singletons.set(registration.token, { status: 'resolved', value: produced })
        entry.instances.set(registration.token, produced)
    }
    if (isThenable(produced)) {
        const key = typeof registration.token === 'string' ? registration.token : null
        const pending = Promise.resolve(produced).then(
            (value: unknown) => {
                if (key !== null && entry.claimedSingletons.has(key)) {
                    ctx.singletons.set(key, { status: 'resolved', value })
                }
                entry.instances.set(registration.token, value)
                return value
            },
            (error: unknown) => {
                if (key !== null && entry.claimedSingletons.has(key)) {
                    const current = ctx.singletons.get(key)
                    const marker = entry.claimMarkers.get(key)
                    // Evict the slot this mount owns: either the original claim
                    // marker or the in-flight record installed below, which
                    // replaced the marker. Without the in-flight comparison a
                    // rejection leaves a stale rejected promise behind and
                    // every retry degrades to a spurious SINGLETON_CONFLICT
                    // (self-healing retries require prompt eviction).
                    const ownsSlot = marker !== undefined
                        && (current === marker
                            || (current !== undefined && current.status === 'inflight' && current.promise === pending))
                    if (ownsSlot) {
                        ctx.singletons.delete(key)
                    }
                }
                throw error
            },
        )
        if (key !== null && entry.claimedSingletons.has(key)) {
            const inflight: { status: 'inflight', promise: Promise<unknown> } = { status: 'inflight', promise: pending }
            ctx.singletons.set(key, inflight)
        }
        return pending
    }
    return produced
}

/** Warms every eager service in parallel through the registry coalescing guard. */
const warmEager = async (
    entry: SessionEntry<Record<PropertyKey, unknown>>,
    ctx: ApplicationContext,
): Promise<void> => {
    const eager = [...entry.blueprint.providers.values()].filter((registration) => registration.eager)
    await Promise.all(eager.map((registration) =>
        entry.record.services.resolveAsync(registration.token, () => instantiateEager(ctx, entry, registration))
    ))
}

/** Claims singleton ownership; duplicates route `SINGLETON_CONFLICT` to the loser channel. */
const claimSingletons = (
    ctx: ApplicationContext,
    entry: SessionEntry<Record<PropertyKey, unknown>>,
): void => {
    for (const registration of entry.blueprint.providers.values()) {
        if (registration.lifecycle !== 'singleton' || typeof registration.token !== 'string') {
            continue
        }
        const key = registration.token
        if (ctx.singletons.has(key)) {
            entry.channel.push(new DocumentContextError('SINGLETON_CONFLICT', {
                token: key,
                winner: 'first-registration',
                factoryMismatch: false,
            }))
            continue
        }
        const marker: { status: 'resolved', value: unknown } = { status: 'resolved', value: undefined }
        ctx.singletons.set(key, marker)
        entry.claimedSingletons.add(key)
        entry.claimMarkers.set(key, marker)
    }
}

/** Runs `onMount` FIFO; any throw or rejection fails the mount per D-102. */
const runOnMount = async (
    ctx: ApplicationContext,
    entry: SessionEntry<Record<PropertyKey, unknown>>,
): Promise<void> => {
    for (const hook of entry.blueprint.hooks.filter((candidate) => candidate.event === 'mount')) {
        let produced: unknown
        try {
            produced = (hook.handler as unknown as (session: unknown) => unknown)(entry.facade)
        } catch (error) {
            const failure = new DocumentContextError('HOOK_ERROR', { hook: 'mount', error })
            entry.channel.push(failure)
            releaseMarkers(ctx, entry)
            disposeEntry(ctx, entry.facade)
            throw failure
        }
        if (isThenable(produced)) {
            try {
                produced = await produced
            } catch (error) {
                const failure = new DocumentContextError('HOOK_ERROR', { hook: 'mount', error })
                entry.channel.push(failure)
                releaseMarkers(ctx, entry)
                disposeEntry(ctx, entry.facade)
                throw failure
            }
        }
        if (typeof produced === 'function') {
            entry.cleanups.push(produced as () => unknown)
        }
    }
}

/** Hydrates the seed through storage and the SSR payload; never throws for data problems. */
const hydrateForMount = async <S extends Record<PropertyKey, unknown>>(
    ctx: ApplicationContext,
    blueprint: ContextBlueprint<S>,
    token: string | null,
    options: MountOptions,
    seedOverride: S | undefined,
): Promise<HydrateStateResult<S>> => {
    const storageOptions = blueprint.storage
    let storagePort: StoragePort | null = null
    let storageKey = ''
    if (storageOptions !== null) {
        const backend = storageOptions.storage
        if (typeof backend === 'string') {
            const resolved = ctx.ports.storage.resolve(backend)
            if (resolved === null) {
                throw new DocumentContextError('UNKNOWN_SERVICE', { token: backend })
            }
            storagePort = resolved
        } else {
            storagePort = backend
        }
        storageKey = storageOptions.key
    }
    let payload: Record<string, unknown> | null = null
    if (options.ssrPayload !== 'off') {
        const resolver = ctx.ports.ssr?.payloadResolver ?? null
        if (resolver !== null) {
            const raw: unknown = resolver(token)
            if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
                payload = raw as Record<string, unknown>
            }
        }
    }
    const seed = seedOverride ?? { ...blueprint.initial }
    if (storagePort === null && payload === null) {
        return { state: seed, outcome: 'fresh', errors: [], writeBlocked: false }
    }
    const strategy = storageOptions?.hydration ?? 'storageFirst'
    const version = storageOptions?.version ?? 0
    const migrate = storageOptions?.migrate as unknown as ((persisted: unknown, oldVersion: number) => Partial<S>) | undefined
    return hydrateState<S>({
        blueprintInitial: seed,
        ...(storagePort !== null ? { storage: { port: storagePort, key: storageKey } } : {}),
        ...(payload !== null ? { payload } : {}),
        strategy,
        version,
        ...(migrate !== undefined ? { migrate } : {}),
    })
}

/** Resolves the normalized keyed identity; `options.token` wins over the adapter. NullHost mounts (SSR) skip the adapter read: identity comes from options only. */
const resolveKeyToken = (
    ctx: ApplicationContext,
    host: HostPort,
    options: MountOptions,
    isNullHost: boolean,
): string | null => {
    const native: unknown = isNullHost ? null : host.native()
    const fromAdapter = native === null ? null : ctx.ports.host.tokens.read(native)
    const fromOptions = options.token
    if (fromOptions !== undefined) {
        validateTokenName(fromOptions)
        if (fromAdapter !== null && fromAdapter !== fromOptions) {
            const policy = options.onConflict ?? 'throw'
            if (policy === 'throw') {
                throw new DocumentContextError('KEYED_SESSION_CONFLICT', { token: fromOptions })
            }
        }
        return fromOptions
    }
    if (fromAdapter !== null) {
        validateTokenName(fromAdapter)
        return fromAdapter
    }
    return null
}

/** Assembles the public facade over a live entry; flags read the record status live. */
const buildFacade = <S extends Record<PropertyKey, unknown>, Host>(
    ctx: ApplicationContext,
    entry: SessionEntry<S>,
): Session<S, Host> => {
    const hostFacade: HostPort = {
        get token(): string | null {
            return entry.hostBox.current.token
        },
        get isConnected(): boolean {
            return entry.hostBox.current.isConnected
        },
        get parent(): HostPort | null {
            return entry.hostBox.current.parent
        },
        get lifecycle$(): Observable<HostLifecycleEvent> {
            return entry.hostEvents.asObservable()
        },
        on(type: string, listener: (event: unknown) => void, options?: {
            readonly capture?: boolean
            readonly passive?: boolean
            readonly once?: boolean
            readonly signal?: AbortSignal
        }): () => void {
            return entry.hostBox.current.on(type, listener, options)
        },
        native(): unknown {
            return entry.hostBox.current.native()
        },
    }
    entry.hostFacade = hostFacade
    const facade = {
        host: hostFacade as HostPort<Host>,
        token: entry.token,
        get isConnected(): boolean {
            return entry.hostBox.current.isConnected
        },
        get isSuspended(): boolean {
            return entry.record.status === 'suspended'
        },
        get isDisposed(): boolean {
            return entry.record.status === 'disposed'
        },
        abortSignal: entry.record.abortController.signal,
        state$: entry.record.sessionState.state$ as Observable<S>,
        errors$: entry.channel.errors$(),
        lifecycle$: entry.lifecycle.asObservable(),
        abort$: entry.record.abort$,
    } as unknown as Session<S, Host>
    const slot = facade as unknown as Record<symbol, unknown>
    const disposable = (Symbol as unknown as { readonly dispose?: symbol }).dispose
    if (disposable !== undefined) {
        slot[disposable] = (): void => {
            disposeEntry(ctx, facade as unknown as Session)
        }
    }
    const asyncDisposable = (Symbol as unknown as { readonly asyncDispose?: symbol }).asyncDispose
    if (asyncDisposable !== undefined) {
        slot[asyncDisposable] = async (): Promise<void> => {
            disposeEntry(ctx, facade as unknown as Session)
            await entry.settled
        }
    }
    slot[ENTRY_SLOT] = entry as unknown as SessionEntry<Record<PropertyKey, unknown>>
    return facade
}

/** Revives a suspended (or disconnect-pending) entry on a new host with state intact. */
const resuscitateEntry = async <S extends Record<PropertyKey, unknown>>(
    ctx: ApplicationContext,
    raw: SessionEntry<Record<PropertyKey, unknown>>,
    newHost: HostPort,
): Promise<Session> => {
    const entry = raw as unknown as SessionEntry<S>
    const record = entry.record as unknown as MountSessionRecord<S>
    if (entry.ttlCancel !== null) {
        entry.ttlCancel()
        entry.ttlCancel = null
    }
    entry.disconnectPending = false
    removeFromSuspended(ctx, entry.facade)
    const oldKey = entry.nativeKey
    if (entry.hostSub !== null) {
        entry.hostSub.unsubscribe()
        entry.hostSub = null
    }
    if (entry.offRequest !== null) {
        entry.offRequest()
        entry.offRequest = null
    }
    if (entry.forwardSub !== null) {
        entry.forwardSub.unsubscribe()
        entry.forwardSub = null
    }
    entry.hostBox.current = newHost
    record.host = newHost
    // NullHost targets (SSR) expose no native node: fall back to the host
    // itself, mirroring the fresh-mount `native` for nullHost sessions.
    let newNative: unknown
    try {
        newNative = newHost.native()
    } catch {
        newNative = newHost
    }
    entry.native = newNative
    entry.nativeKey = keyOf(newHost)
    ctx.sessions.delete(oldKey)
    ctx.sessions.set(entry.nativeKey, {
        facade: entry.facade,
        record: entry.record as unknown as MountSessionRecord<Record<PropertyKey, unknown>>,
    })
    // D-49: server (nullHost) resuscitation never runs deferred `onMount`;
    // the flag stays set so a later DOM resuscitation still runs it.
    const targetIsNullHost = ctx.ports.ssr !== undefined && newHost === ctx.ports.ssr.nullHost
    if (entry.token !== null) {
        ctx.keyed.set(entry.token, entry.facade)
        if (!entry.isNullHost && !targetIsNullHost) {
            ctx.ports.host.tokens.write(newNative, entry.token)
        }
    }
    entry.hostSub = newHost.lifecycle$.subscribe(watchHost(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>))
    entry.forwardSub = newHost.lifecycle$.subscribe((event: HostLifecycleEvent) => {
        entry.hostEvents.next(event)
    })
    if (record.status === 'mounted') {
        record.status = transition(record.status, 'disconnect', record.kind)
    }
    record.status = transition(record.status, 'resuscitate', record.kind)
    if (record.onMountSkipped && !targetIsNullHost) {
        record.onMountSkipped = false
        await runOnMount(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
    }
    runHookList(entry as unknown as SessionEntry<Record<PropertyKey, unknown>>, 'resuscitate', (handler) => {
        (handler as unknown as (session: unknown, host: unknown) => unknown)(entry.facade, entry.hostFacade)
    })
    installResponder(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
    entry.lifecycle.next({ type: 'resuscitated' })
    return entry.facade as unknown as Session
}

/** Settles a waiting-disconnect keyed mount without `onMount` or responder. */
const settleSuspendedMount = <S extends Record<PropertyKey, unknown>>(
    ctx: ApplicationContext,
    entry: SessionEntry<S>,
): Session<S, unknown> => {
    if (entry.token !== null && ctx.keyed.get(entry.token) === undefined) {
        ctx.keyed.set(entry.token, entry.facade)
    }
    entry.lifecycle.next({ type: 'suspended' })
    armSuspended(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
    return entry.facade as unknown as Session<S, unknown>
}

/** Creates a live entry, facade, and init wiring for one fresh mount. */
const startFreshMount = <S extends Record<PropertyKey, unknown>>(
    ctx: ApplicationContext,
    blueprint: ContextBlueprint<S>,
    options: MountOptions,
    host: HostPort,
    nativeKey: object,
    native: unknown,
    token: string | null,
    kind: SessionKind,
    isNullHost: boolean,
    hydrated: S,
): { entry: SessionEntry<S>, facade: Session<S, unknown> } => {
    const scheduler = ctx.ports.host.scheduler
    const stripped: ContextBlueprint<S> = {
        ...blueprint,
        initial: hydrated,
        providers: new Map([...blueprint.providers.entries()].map(([key, registration]) => [
            key,
            registration.eager ? { ...registration, eager: false } : registration,
        ] as [Token, ServiceRegistration])),
    }
    const kernel = mountSession({ blueprint: stripped, host, kind, token, ports: { scheduler } })
    const record = kernel.record
    const channel = createErrorChannel()
    const split = splitRegistrations(blueprint as unknown as ContextBlueprint<Record<PropertyKey, unknown>>)
    // Share the service index with the injection walk: `toSyncStore` in
    // `api/inject.js` resolves session-local services from the
    // `singles`/`multis` maps carried alongside the domain registry. Without
    // this attachment the record carries only the registry handle (which
    // exposes no registration listing), the walk finds no store, and
    // `inject` degrades to transport-only even for locally mounted services.
    // The same map references back `entry.singles`/`entry.multis`, so the
    // responder, warming, and injection observe one index; the maps live and
    // die with the record across resuscitation.
    const indexedRecord = record as unknown as {
        singles: Map<Token, ServiceRegistration>
        multis: Map<Token, Array<ServiceRegistration>>
    }
    indexedRecord.singles = split.singles
    indexedRecord.multis = split.multis
    let resolveSettled!: () => void
    const settled = new Promise<void>((resolve) => {
        resolveSettled = resolve
    })
    const entry: SessionEntry<S> = {
        record,
        blueprint,
        hostFacade: null as unknown as HostPort,
        hostBox: { current: host },
        hostEvents: new Subject<HostLifecycleEvent>(),
        native,
        nativeKey,
        token,
        kind,
        channel,
        lifecycle: new Subject<LifecycleEvent>(),
        facade: null as unknown as Session,
        singles: split.singles,
        multis: split.multis,
        instances: new Map<Token, unknown>(),
        claimedSingletons: new Set<string>(),
        claimMarkers: new Map(),
        kernel,
        ready: Promise.resolve(),
        warming: true,
        cleanups: [],
        offRequest: null,
        hostSub: null,
        forwardSub: null,
        ttlCancel: null,
        ttlMs: options.suspensionTtlMs ?? 50,
        retention: options.retention ?? 'default',
        observer: options.observer ?? (ctx.ports.observer ?? 'auto') !== 'off',
        isNullHost,
        disconnectPending: false,
        disposed: false,
        pendingAsync: 0,
        settled,
        resolveSettled,
        scheduler,
    }
    const facade = buildFacade<S, unknown>(ctx, entry)
    entry.facade = facade as unknown as Session
    entry.ready = (async (): Promise<void> => {
        await kernel.ready
        await warmEager(entry as unknown as SessionEntry<Record<PropertyKey, unknown>>, ctx)
    })()
    void entry.ready.then(
        () => {
            entry.warming = false
        },
        () => {
            entry.warming = false
        },
    )
    ctx.sessions.set(nativeKey, {
        facade: facade as unknown as Session,
        record: record as unknown as MountSessionRecord<Record<PropertyKey, unknown>>,
    })
    ctx.records.set(facade as unknown as object, record as unknown as MountSessionRecord<Record<PropertyKey, unknown>>)
    if (token !== null && !isNullHost) {
        ctx.ports.host.tokens.write(native, token)
    }
    claimSingletons(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
    entry.hostSub = host.lifecycle$.subscribe(watchHost(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>))
    entry.forwardSub = host.lifecycle$.subscribe((event: HostLifecycleEvent) => {
        entry.hostEvents.next(event)
    })
    return { entry, facade }
}

/** Fresh async mount after idempotency and conflict checks. */
const mountFresh = async <S extends Record<PropertyKey, unknown>, Host>(
    ctx: ApplicationContext,
    blueprint: ContextBlueprint<S>,
    options: MountOptions,
    host: HostPort,
    nativeKey: object,
    native: unknown,
    token: string | null,
    kind: SessionKind,
    isNullHost: boolean,
    seedOverride: S | undefined,
): Promise<Session<S, Host>> => {
    const signal = options.signal
    let abortSettled: ((reason?: unknown) => void) | null = null
    const abortLatch = signal !== undefined
        ? new Promise<never>((_, reject) => {
            abortSettled = reject
        })
        : null
    const hydrated = await hydrateForMount(ctx, blueprint, token, options, seedOverride)
    const hydrateErrors = [...hydrated.errors]
    if (signal?.aborted === true) {
        throw signal.reason
    }
    if (!isNullHost && !host.isConnected && kind === 'anonymous') {
        throw new DocumentContextError('UNCONNECTED_NODE', { connected: false })
    }
    const { entry, facade } = startFreshMount(ctx, blueprint, options, host, nativeKey, native, token, kind, isNullHost, hydrated.state)
    for (const error of hydrateErrors) {
        entry.channel.push(error)
    }
    const onAbort = (): void => {
        entry.kernel.abort(signal?.reason)
        abortSettled?.(signal?.reason)
    }
    if (signal !== undefined) {
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) {
            // Abort landed before the listener attached; drive the kernel path now.
            onAbort()
        }
    }
    try {
        if (abortLatch !== null) {
            await Promise.race([entry.ready, abortLatch])
        } else {
            await entry.ready
        }
    } catch (error) {
        if (signal !== undefined) {
            signal.removeEventListener('abort', onAbort)
        }
        if (isAborted(signal)) {
            releaseMarkers(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
            disposeEntry(ctx, facade as unknown as Session)
            throw signal?.reason
        }
        releaseMarkers(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
        disposeEntry(ctx, facade as unknown as Session)
        throw error
    }
    if (signal !== undefined) {
        signal.removeEventListener('abort', onAbort)
    }
    if (isAborted(signal)) {
        const reason: unknown = signal?.reason
        try {
            entry.kernel.abort(reason)
        } catch {
            // Kernel guards settled records; teardown proceeds regardless.
        }
        releaseMarkers(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
        disposeEntry(ctx, facade as unknown as Session)
        throw reason
    }
    if (entry.record.status === 'suspended') {
        // Waiting-disconnect (kernel sets the flag) or a recheck suspend
        // during warming (flag it here) both defer `onMount` to resuscitation.
        entry.record.onMountSkipped = true
        return settleSuspendedMount(ctx, entry) as unknown as Session<S, Host>
    }
    if (!isNullHost && !entry.hostBox.current.isConnected) {
        if (kind === 'anonymous') {
            releaseMarkers(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
            disposeEntry(ctx, facade as unknown as Session)
            throw new DocumentContextError('UNCONNECTED_NODE', { connected: false })
        }
        entry.record.onMountSkipped = true
        entry.record.status = transition(entry.record.status, 'disconnect', entry.record.kind)
        return settleSuspendedMount(ctx, entry) as unknown as Session<S, Host>
    }
    if (token !== null) {
        const rival = ctx.keyed.get(token)
        if (rival !== undefined && rival !== (facade as unknown as Session)) {
            const rivalRecord = ctx.records.get(rival as unknown as object)
            if (rivalRecord?.status === 'suspended') {
                releaseMarkers(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
                disposeEntry(ctx, facade as unknown as Session)
                const rivalEntry = readEntry<Record<PropertyKey, unknown>>(rival)
                if (rivalEntry === undefined) {
                    throw new DocumentContextError('KEYED_SESSION_CONFLICT', { token, hosts: 2 })
                }
                return resuscitateEntry(ctx, rivalEntry, host) as unknown as Promise<Session<S, Host>>
            }
            if (rivalRecord?.status === 'mounted' || rivalRecord?.status === 'initializing') {
                releaseMarkers(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
                disposeEntry(ctx, facade as unknown as Session)
                throw new DocumentContextError('KEYED_SESSION_CONFLICT', { token, hosts: 2 })
            }
        }
        ctx.keyed.set(token, facade as unknown as Session)
    }
    if (!isNullHost) {
        await runOnMount(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
    }
    installResponder(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
    entry.lifecycle.next({ type: 'mounted' })
    return facade as unknown as Session<S, Host>
}

/** Core async mount: gates, idempotency, conflicts, then a fresh mount. */
const mountInner = async <S extends Record<PropertyKey, unknown>, Host>(
    ctx: ApplicationContext,
    blueprint: ContextBlueprint<S>,
    options: MountOptions,
    element: Host,
): Promise<Session<S, Host>> => {
    const ssr = ctx.ports.ssr
    let host: HostPort
    let isNullHost = false
    if (ssr !== undefined && element === ssr.nullHost) {
        host = ssr.nullHost
        isNullHost = true
    } else if (isHostPortLike(element)) {
        host = element
    } else {
        try {
            host = ctx.ports.host.toHost(element)
        } catch (error) {
            if (error instanceof DocumentContextError) {
                throw error
            }
            throw new DocumentContextError('HOST_INVALID', { reason: 'toHost-rejected' })
        }
    }
    const signal = options.signal
    if (isAborted(signal)) {
        throw signal?.reason
    }
    if (!isNullHost && !host.isConnected) {
        throw new DocumentContextError('UNCONNECTED_NODE', { connected: host.isConnected })
    }
    const token = resolveKeyToken(ctx, host, options, isNullHost)
    const kind: SessionKind = token === null ? 'anonymous' : 'keyed'
    const ttlMs = options.suspensionTtlMs ?? 50
    const retention = options.retention ?? 'default'
    if (ttlMs === Infinity && retention !== 'pinned') {
        throw new Error('[document-context] suspensionTtlMs: Infinity requires retention: \'pinned\'')
    }
    const nativeKey = keyOf(host)
    const native: unknown = isNullHost ? host : host.native()
    let seedOverride: S | undefined
    let evicted = false
    for (;;) {
        const cached = ctx.sessions.get(nativeKey)
        if (cached !== undefined && cached.record.token === token) {
            const cachedEntry = readEntry<Record<PropertyKey, unknown>>(cached.facade)
            if (cached.record.status === 'initializing' || (cachedEntry !== undefined && cachedEntry.warming)) {
                if (cachedEntry !== undefined) {
                    await cachedEntry.ready
                }
                return cached.facade as unknown as Session<S, Host>
            }
            if (cached.record.status === 'suspended' && cachedEntry !== undefined) {
                return resuscitateEntry(ctx, cachedEntry, host) as unknown as Promise<Session<S, Host>>
            }
            return cached.facade as unknown as Session<S, Host>
        }
        if (cached !== undefined) {
            const policy = options.onConflict ?? 'throw'
            if (policy === 'throw') {
                throw new DocumentContextError('KEYED_SESSION_CONFLICT', { token: token ?? cached.record.token ?? null })
            }
            if (!evicted) {
                evicted = true
                if (policy === 'reset') {
                    seedOverride = { ...cached.record.sessionState.getSnapshot() } as unknown as S
                }
                disposeEntry(ctx, cached.facade)
            }
        }
        if (token !== null) {
            const known = ctx.keyed.get(token)
            if (known !== undefined) {
                const knownRecord = ctx.records.get(known as unknown as object)
                const knownEntry = readEntry<Record<PropertyKey, unknown>>(known)
                if (knownRecord !== undefined && knownEntry !== undefined && !knownEntry.disposed) {
                    if (knownRecord.status === 'suspended'
                        || (knownRecord.status === 'mounted' && knownEntry.disconnectPending)
                        || (knownRecord.status === 'mounted' && !knownEntry.hostBox.current.isConnected)) {
                        return resuscitateEntry(ctx, knownEntry, host) as unknown as Promise<Session<S, Host>>
                    }
                    if (knownRecord.status === 'mounted' && knownEntry.hostBox.current.isConnected && host.isConnected && !isNullHost) {
                        throw new DocumentContextError('KEYED_SESSION_CONFLICT', { token, hosts: 2 })
                    }
                }
            }
        }
        const slots = slotsFor(ctx)
        const nativePending = slots.byNative.get(nativeKey)
        if (nativePending !== undefined) {
            try {
                await nativePending
            } catch {
                // A failed peer frees the retry; loop re-evaluates from the registries.
            }
            continue
        }
        if (token !== null) {
            const tokenPending = slots.byToken.get(token)
            if (tokenPending !== undefined) {
                try {
                    await tokenPending
                } catch {
                    // A failed peer frees the retry; loop re-evaluates from the registries.
                }
                continue
            }
        }
        const pending = mountFresh(ctx, blueprint, options, host, nativeKey, native, token, kind, isNullHost, seedOverride)
        slots.byNative.set(nativeKey, pending)
        if (token !== null) {
            slots.byToken.set(token, pending)
        }
        try {
            return (await pending) as unknown as Session<S, Host>
        } finally {
            if (slots.byNative.get(nativeKey) === pending) {
                slots.byNative.delete(nativeKey)
            }
            if (token !== null && slots.byToken.get(token) === pending) {
                slots.byToken.delete(token)
            }
        }
    }
}

/** Shallow merge with `CreateDataProperty` semantics mirroring hydration depth. */
const shallowMergeSync = (base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> => {
    const next: Record<string, unknown> = { ...base }
    for (const key of Object.keys(overlay)) {
        Object.defineProperty(next, key, {
            value: overlay[key],
            enumerable: true,
            writable: true,
            configurable: true,
        })
    }
    return next
}

/** Synchronous hydration projection for `mountSync`; parity-tested against `hydrateState`. */
const hydrateSync = <S extends Record<PropertyKey, unknown>>(
    blueprintInitial: S,
    raw: string | null,
    payload: Record<string, unknown> | null,
    strategy: 'storageFirst' | 'payloadFirst' | 'blueprintFirst' | 'merge',
    version: number,
    migrate: ((persisted: unknown, oldVersion: number) => Partial<S>) | undefined,
    storageKey: string,
): { state: S, errors: Array<DocumentContextError>, writeBlocked: boolean } => {
    const errors: Array<DocumentContextError> = []
    const seed = { ...blueprintInitial } as Record<string, unknown>
    let storageSide: Record<string, unknown> | null = null
    let newerBlocked = false
    if (raw !== null) {
        let parsed: unknown = null
        try {
            parsed = JSON.parse(raw)
        } catch {
            parsed = null
        }
        const envelope: Record<string, unknown> | null = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null
        if (envelope !== null && typeof envelope['v'] === 'number' && 'd' in envelope) {
            const storedVersion = envelope['v'] as number
            const storedData: unknown = envelope['d']
            const isDataRecord = typeof storedData === 'object' && storedData !== null && !Array.isArray(storedData)
            if (storedVersion === version) {
                if (isDataRecord) {
                    storageSide = { ...(storedData as Record<string, unknown>) }
                } else {
                    errors.push(new DocumentContextError('INVALID_STORAGE_DATA', { key: storageKey }))
                }
            } else if (storedVersion < version) {
                if (migrate !== undefined) {
                    try {
                        const migratedPartial = migrate(storedData, storedVersion)
                        if (typeof migratedPartial === 'object' && migratedPartial !== null && !Array.isArray(migratedPartial)) {
                            storageSide = { ...(migratedPartial as Record<string, unknown>) }
                        } else {
                            errors.push(new DocumentContextError('INVALID_STORAGE_DATA', { key: storageKey }))
                        }
                    } catch {
                        errors.push(new DocumentContextError('INVALID_STORAGE_DATA', { key: storageKey }))
                    }
                } else {
                    errors.push(new DocumentContextError('INVALID_STORAGE_DATA', { key: storageKey }))
                }
            } else {
                newerBlocked = true
                errors.push(new DocumentContextError('INVALID_STORAGE_DATA', {
                    key: storageKey,
                    storageVersionGuard: 'newer-blocked',
                }))
            }
        } else {
            errors.push(new DocumentContextError('INVALID_STORAGE_DATA', { key: storageKey }))
        }
    }
    const payloadSide: Record<string, unknown> | null = payload !== null ? { ...payload } : null
    let merged: Record<string, unknown>
    switch (strategy) {
        case 'storageFirst':
            merged = shallowMergeSync(shallowMergeSync(seed, payloadSide ?? {}), storageSide ?? {})
            break
        case 'payloadFirst':
            merged = shallowMergeSync(shallowMergeSync(seed, storageSide ?? {}), payloadSide ?? {})
            break
        case 'blueprintFirst':
            merged = shallowMergeSync(shallowMergeSync(storageSide ?? {}, payloadSide ?? {}), seed)
            break
        case 'merge':
            merged = shallowMergeSync(shallowMergeSync(seed, storageSide ?? {}), payloadSide ?? {})
            break
    }
    return { state: merged as S, errors, writeBlocked: newerBlocked }
}

/** Core sync mount: identical rules without waiting; async work throws instead. */
const mountInnerSync = <S extends Record<PropertyKey, unknown>, Host>(
    ctx: ApplicationContext,
    blueprint: ContextBlueprint<S>,
    options: MountOptions,
    element: Host,
): Session<S, Host> => {
    if (options.signal !== undefined && typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[document-context] mountSync ignores MountOptions.signal; use mount for cancellation.')
    }
    const ssr = ctx.ports.ssr
    let host: HostPort
    let isNullHost = false
    if (ssr !== undefined && element === ssr.nullHost) {
        host = ssr.nullHost
        isNullHost = true
    } else if (isHostPortLike(element)) {
        host = element
    } else {
        try {
            host = ctx.ports.host.toHost(element)
        } catch (error) {
            if (error instanceof DocumentContextError) {
                throw error
            }
            throw new DocumentContextError('HOST_INVALID', { reason: 'toHost-rejected' })
        }
    }
    if (!isNullHost && !host.isConnected) {
        throw new DocumentContextError('UNCONNECTED_NODE', { connected: host.isConnected })
    }
    const token = resolveKeyToken(ctx, host, options, isNullHost)
    const kind: SessionKind = token === null ? 'anonymous' : 'keyed'
    const ttlMs = options.suspensionTtlMs ?? 50
    const retention = options.retention ?? 'default'
    if (ttlMs === Infinity && retention !== 'pinned') {
        throw new Error('[document-context] suspensionTtlMs: Infinity requires retention: \'pinned\'')
    }
    const nativeKey = keyOf(host)
    const native: unknown = isNullHost ? host : host.native()
    const slots = peekSlots(ctx)
    if (slots?.byNative.get(nativeKey) !== undefined) {
        throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', { phase: 'Initializing' })
    }
    if (token !== null && slots?.byToken.get(token) !== undefined) {
        throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', { phase: 'Initializing' })
    }
    const cached = ctx.sessions.get(nativeKey)
    if (cached !== undefined && cached.record.token === token) {
        const cachedEntry = readEntry<Record<PropertyKey, unknown>>(cached.facade)
        if (cached.record.status === 'initializing' || (cachedEntry !== undefined && cachedEntry.warming)) {
            throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', { phase: 'Initializing' })
        }
        if (cached.record.status === 'suspended' && cachedEntry !== undefined) {
            if (cached.record.onMountSkipped && blueprint.hooks.some((hook) => hook.event === 'mount')) {
                throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', { phase: 'Initializing' })
            }
            return resuscitateSync(ctx, cachedEntry, host) as unknown as Session<S, Host>
        }
        return cached.facade as unknown as Session<S, Host>
    }
    if (cached !== undefined) {
        const policy = options.onConflict ?? 'throw'
        if (policy === 'throw') {
            throw new DocumentContextError('KEYED_SESSION_CONFLICT', { token: token ?? cached.record.token ?? null })
        }
        const seed = policy === 'reset'
            ? ({ ...cached.record.sessionState.getSnapshot() } as unknown as S)
            : undefined
        disposeEntry(ctx, cached.facade)
        return mountFreshSync(ctx, blueprint, options, host, nativeKey, native, token, kind, isNullHost, seed)
    }
    if (token !== null) {
        const known = ctx.keyed.get(token)
        if (known !== undefined) {
            const knownRecord = ctx.records.get(known as unknown as object)
            const knownEntry = readEntry<Record<PropertyKey, unknown>>(known)
            if (knownRecord !== undefined && knownEntry !== undefined && !knownEntry.disposed) {
                if (knownRecord.status === 'suspended'
                    || (knownRecord.status === 'mounted' && (knownEntry.disconnectPending || !knownEntry.hostBox.current.isConnected))) {
                    if (knownRecord.onMountSkipped && blueprint.hooks.some((hook) => hook.event === 'mount')) {
                        throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', { phase: 'Initializing' })
                    }
                    return resuscitateSync(ctx, knownEntry, host) as unknown as Session<S, Host>
                }
                if (knownRecord.status === 'initializing' || knownEntry.warming) {
                    throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', { phase: 'Initializing' })
                }
                if (knownRecord.status === 'mounted' && knownEntry.hostBox.current.isConnected && host.isConnected && !isNullHost) {
                    throw new DocumentContextError('KEYED_SESSION_CONFLICT', { token, hosts: 2 })
                }
            }
        }
    }
    return mountFreshSync(ctx, blueprint, options, host, nativeKey, native, token, kind, isNullHost, undefined)
}

/** Synchronous resuscitation; deferred async `onMount` throws instead of waiting. */
const resuscitateSync = (
    ctx: ApplicationContext,
    raw: SessionEntry<Record<PropertyKey, unknown>>,
    newHost: HostPort,
): Session => {
    const entry = raw
    if (entry.ttlCancel !== null) {
        entry.ttlCancel()
        entry.ttlCancel = null
    }
    entry.disconnectPending = false
    removeFromSuspended(ctx, entry.facade)
    const oldKey = entry.nativeKey
    if (entry.hostSub !== null) {
        entry.hostSub.unsubscribe()
        entry.hostSub = null
    }
    if (entry.offRequest !== null) {
        entry.offRequest()
        entry.offRequest = null
    }
    if (entry.forwardSub !== null) {
        entry.forwardSub.unsubscribe()
        entry.forwardSub = null
    }
    entry.hostBox.current = newHost
    entry.record.host = newHost
    // NullHost targets (SSR) expose no native node: fall back to the host
    // itself, mirroring the fresh-mount `native` for nullHost sessions.
    let newNative: unknown
    try {
        newNative = newHost.native()
    } catch {
        newNative = newHost
    }
    entry.native = newNative
    entry.nativeKey = keyOf(newHost)
    ctx.sessions.delete(oldKey)
    ctx.sessions.set(entry.nativeKey, { facade: entry.facade, record: entry.record })
    // D-49: server (nullHost) resuscitation never runs deferred `onMount`;
    // the flag stays set so a later DOM resuscitation still runs it.
    const targetIsNullHost = ctx.ports.ssr !== undefined && newHost === ctx.ports.ssr.nullHost
    if (entry.token !== null) {
        ctx.keyed.set(entry.token, entry.facade)
        if (!entry.isNullHost && !targetIsNullHost) {
            ctx.ports.host.tokens.write(newNative, entry.token)
        }
    }
    entry.hostSub = newHost.lifecycle$.subscribe(watchHost(ctx, entry))
    entry.forwardSub = newHost.lifecycle$.subscribe((event: HostLifecycleEvent) => {
        entry.hostEvents.next(event)
    })
    if (entry.record.status === 'mounted') {
        entry.record.status = transition(entry.record.status, 'disconnect', entry.record.kind)
    }
    entry.record.status = transition(entry.record.status, 'resuscitate', entry.record.kind)
    if (entry.record.onMountSkipped && !targetIsNullHost) {
        entry.record.onMountSkipped = false
        for (const hook of entry.blueprint.hooks.filter((candidate) => candidate.event === 'mount')) {
            let produced: unknown
            try {
                produced = (hook.handler as unknown as (session: unknown) => unknown)(entry.facade)
            } catch (error) {
                const failure = new DocumentContextError('HOOK_ERROR', { hook: 'mount', error })
                entry.channel.push(failure)
                releaseMarkers(ctx, entry)
                disposeEntry(ctx, entry.facade)
                throw failure
            }
            if (isThenable(produced)) {
                releaseMarkers(ctx, entry)
                disposeEntry(ctx, entry.facade)
                throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', { phase: 'Initializing' })
            }
            if (typeof produced === 'function') {
                entry.cleanups.push(produced as () => unknown)
            }
        }
    }
    runHookList(entry, 'resuscitate', (handler) => {
        (handler as unknown as (session: unknown, host: unknown) => unknown)(entry.facade, entry.hostFacade)
    })
    installResponder(ctx, entry)
    entry.lifecycle.next({ type: 'resuscitated' })
    ctx.settled$.next()
    return entry.facade
}

/** Fresh sync mount: sync storage and sync eager only, otherwise `ASYNC_SERVICE_NOT_READY`. */
const mountFreshSync = <S extends Record<PropertyKey, unknown>, Host>(
    ctx: ApplicationContext,
    blueprint: ContextBlueprint<S>,
    options: MountOptions,
    host: HostPort,
    nativeKey: object,
    native: unknown,
    token: string | null,
    kind: SessionKind,
    isNullHost: boolean,
    seedOverride: S | undefined,
): Session<S, Host> => {
    for (const registration of blueprint.providers.values()) {
        if (registration.eager && registration.async) {
            throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', { phase: 'Initializing' })
        }
    }
    const storageOptions = blueprint.storage
    let storagePort: StoragePort | null = null
    let storageKey = ''
    if (storageOptions !== null) {
        const backend = storageOptions.storage
        if (typeof backend === 'string') {
            const resolved = ctx.ports.storage.resolve(backend)
            if (resolved === null) {
                throw new DocumentContextError('UNKNOWN_SERVICE', { token: backend })
            }
            storagePort = resolved
        } else {
            storagePort = backend
        }
        storageKey = storageOptions.key
    }
    let payload: Record<string, unknown> | null = null
    if (options.ssrPayload !== 'off') {
        const resolver = ctx.ports.ssr?.payloadResolver ?? null
        if (resolver !== null) {
            const raw: unknown = resolver(token)
            if (isThenable(raw)) {
                throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', { phase: 'Initializing' })
            }
            if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
                payload = raw as Record<string, unknown>
            }
        }
    }
    let hydrated: S
    const hydrateErrors: Array<DocumentContextError> = []
    if (storagePort === null && payload === null && seedOverride === undefined) {
        hydrated = { ...blueprint.initial }
    } else {
        if (storagePort !== null) {
            const read = storagePort.read(storageKey)
            if (isThenable(read)) {
                throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', { phase: 'Initializing' })
            }
            if (!read.ok) {
                hydrated = { ...(seedOverride ?? blueprint.initial) }
            } else {
                const strategy = storageOptions?.hydration ?? 'storageFirst'
                const version = storageOptions?.version ?? 0
                const migrate = storageOptions?.migrate as unknown as ((persisted: unknown, oldVersion: number) => Partial<S>) | undefined
                const result = hydrateSync(seedOverride ?? blueprint.initial, read.value, payload, strategy, version, migrate, storageKey)
                hydrated = result.state
                for (const error of result.errors) {
                    hydrateErrors.push(error)
                }
            }
        } else {
            const strategy = storageOptions?.hydration ?? 'storageFirst'
            const base = { ...(seedOverride ?? blueprint.initial) } as Record<string, unknown>
            if (strategy === 'blueprintFirst') {
                hydrated = base as S
            } else {
                hydrated = (payload !== null ? shallowMergeSync({ ...base }, payload) : base) as S
            }
        }
    }
    const { entry, facade } = startFreshMount(ctx, blueprint, options, host, nativeKey, native, token, kind, isNullHost, hydrated)
    for (const error of hydrateErrors) {
        entry.channel.push(error)
    }
    entry.warming = false
    for (const registration of blueprint.providers.values()) {
        if (!registration.eager) {
            continue
        }
        try {
            const produced: unknown = entry.record.services.resolveSync(
                registration.token,
                () => instantiateEager(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>, registration),
            )
            if (isThenable(produced)) {
                throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', { phase: 'Initializing' })
            }
        } catch (error) {
            if (error instanceof DocumentContextError && error.code === 'ASYNC_SERVICE_NOT_READY') {
                releaseMarkers(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
                disposeEntry(ctx, facade as unknown as Session)
                throw error
            }
            releaseMarkers(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
            disposeEntry(ctx, facade as unknown as Session)
            throw error
        }
    }
    if (token !== null) {
        const rival = ctx.keyed.get(token)
        if (rival !== undefined && rival !== (facade as unknown as Session)) {
            const rivalRecord = ctx.records.get(rival as unknown as object)
            if (rivalRecord?.status === 'mounted' || rivalRecord?.status === 'initializing' || rivalRecord?.status === 'suspended') {
                releaseMarkers(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
                disposeEntry(ctx, facade as unknown as Session)
                throw new DocumentContextError('KEYED_SESSION_CONFLICT', { token, hosts: 2 })
            }
        }
        ctx.keyed.set(token, facade as unknown as Session)
    }
    // D-49: server (nullHost) mounts never run `onMount`; data loading on
    // the server flows through hydration plus eager providers only.
    if (!isNullHost) {
        for (const hook of blueprint.hooks.filter((candidate) => candidate.event === 'mount')) {
            let produced: unknown
            try {
                produced = (hook.handler as unknown as (session: unknown) => unknown)(facade)
            } catch (error) {
                const failure = new DocumentContextError('HOOK_ERROR', { hook: 'mount', error })
                entry.channel.push(failure)
                releaseMarkers(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
                disposeEntry(ctx, facade as unknown as Session)
                throw failure
            }
            if (isThenable(produced)) {
                releaseMarkers(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
                disposeEntry(ctx, facade as unknown as Session)
                throw new DocumentContextError('ASYNC_SERVICE_NOT_READY', { phase: 'Initializing' })
            }
            if (typeof produced === 'function') {
                entry.cleanups.push(produced as () => unknown)
            }
        }
    }
    installResponder(ctx, entry as unknown as SessionEntry<Record<PropertyKey, unknown>>)
    entry.lifecycle.next({ type: 'mounted' })
    ctx.settled$.next()
    return facade as unknown as Session<S, Host>
}

/**
 * Creates the async mount verb over an application context. Mount waits for
 * storage hydration and eager services before resolving the session.
 *
 * Idempotency is host-granular with first-blueprint-wins; same-host in-flight
 * mounts coalesce; cross-host races resolve first-mounted-wins with
 * `KEYED_SESSION_CONFLICT` for losers and genuine dual-active pairs.
 *
 * @param ctx Application context holding ports and registries.
 * @returns Data-last curried mount: `(blueprint, options?) => (element) => Promise<Session>`.
 * @throws `HOST_INVALID` when the element normalizes to no host.
 * @throws `UNCONNECTED_NODE` when a DOM host is not connected.
 * @throws `TOKEN_INVALID` when the keyed identity violates namespace rules.
 * @throws `KEYED_SESSION_CONFLICT` on identity conflicts per `onConflict`.
 * @throws `UNKNOWN_SERVICE` for unregistered storage keywords.
 * @throws `HOOK_ERROR` when an `onMount` hook fails; eager rejections reject bare.
 * @example
 * ```ts
 * import { Subject } from 'rxjs'
 * import { createMount } from './mount.js'
 *
 * const mount = createMount(ctx)
 * const session = await mount(blueprint)(host)
 * ```
 */
export function createMount(ctx: ApplicationContext): <S extends Record<PropertyKey, unknown>, Host>(
    blueprint: ContextBlueprint<S>,
    options?: MountOptions,
) => (element: Host) => Promise<Session<S, Host>> {
    return <S extends Record<PropertyKey, unknown>, Host>(
        blueprint: ContextBlueprint<S>,
        options?: MountOptions,
    ): ((element: Host) => Promise<Session<S, Host>>) => {
        return (element: Host): Promise<Session<S, Host>> => {
            const run = async (): Promise<Session<S, Host>> => {
                try {
                    const session = await mountInner(ctx, blueprint, options ?? {}, element)
                    ctx.settled$.next()
                    return session
                } catch (error) {
                    ctx.settled$.next()
                    throw error
                }
            }
            return run()
        }
    }
}

/**
 * Creates the synchronous mount projection over an application context.
 * It never waits: async eager services, async storage reads, in-flight
 * windows, and async `onMount` hooks throw `ASYNC_SERVICE_NOT_READY`
 * instead. Full keyed, TTL, resuscitation, and `onConflict` rules apply.
 *
 * @deprecated Synchronous projection (D-114): stable only through `0.1.x`,
 * removed in `0.2.0`. New code must use the async `mount` verb.
 * @param ctx Application context holding ports and registries.
 * @returns Data-last curried sync mount: `(blueprint, options?) => (element) => Session`.
 * @throws `ASYNC_SERVICE_NOT_READY` with `details.phase: 'Initializing'` when async work is pending.
 * @throws `HOST_INVALID` when the element normalizes to no host.
 * @throws `UNCONNECTED_NODE` when a DOM host is not connected.
 * @throws `TOKEN_INVALID` when the keyed identity violates namespace rules.
 * @throws `KEYED_SESSION_CONFLICT` on identity conflicts per `onConflict`.
 * @example
 * ```ts
 * import { createMountSync } from './mount.js'
 *
 * const mountSync = createMountSync(ctx)
 * const session = mountSync(blueprint)(host)
 * ```
 */
export function createMountSync(ctx: ApplicationContext): <S extends Record<PropertyKey, unknown>, Host>(
    blueprint: ContextBlueprint<S>,
    options?: MountOptions,
) => (element: Host) => Session<S, Host> {
    return <S extends Record<PropertyKey, unknown>, Host>(
        blueprint: ContextBlueprint<S>,
        options?: MountOptions,
    ): ((element: Host) => Session<S, Host>) => {
        return (element: Host): Session<S, Host> => mountInnerSync(ctx, blueprint, options ?? {}, element)
    }
}
