/**
 * Suspend and resuscitation orchestration for keyed sessions.
 *
 * This module is pure orchestration over injected ports: no DOM access, no real
 * timers. All time flows through the injected `SchedulerPort`; timestamps flow
 * through the injected `now` clock. It runs in a plain Node environment.
 *
 * Semantics follow the domain model: `Mounted` parks in `Suspended` on
 * disconnect where the service plane stays alive (scoped caches kept,
 * `state$` keeps evolving) while element-target resolution goes blind.
 * Resuscitation rebinds the same record to a new host with no re-hydration:
 * state and services are preserved by reference and the snapshot is never
 * rewritten here.
 *
 * Deferred to the application layer: the per-Document Suspended table with
 * `{ ref, weak }` strong slots, `maxSuspendedPerDocument` cap enforcement
 * (use {@link evictOldest} to pick the victim), `lifecycle$` emissions
 * (`suspended` / `resuscitated` / `disposed` with `details.evicted`), the
 * `WeakRef` native downgrade with deref-or-throw, `onSuspend` / `onResuscitate`
 * hooks, deferred `onMount` for initializing-origin suspensions, and
 * Application-teardown clearing of `pinned` entries.
 */

import { transition } from '../model/lifecycle.js'
import type { SessionKind, SessionStatus } from '../model/lifecycle.js'
import type { HostPort } from '../ports/host.js'
import type { SchedulerPort } from '../ports/scheduler.js'
import type { ServiceRegistryHandle } from '../model/service.js'
import type { SessionState } from '../model/session.js'

/**
 * Minimal session record shape sufficient for suspend and resuscitation. It is
 * structurally compatible with the mount usecase record: the same object
 * reference is preserved across suspend and resuscitate so `session$` can
 * re-emit the identical object.
 */
export interface SuspendableRecord<S extends Record<PropertyKey, unknown>> {
    /** Session identity kind deciding suspend-versus-dispose splits. */
    kind: SessionKind
    /** Normalized keyed identity, or null for anonymous sessions. */
    token: string | null
    /** Current host; repointed to the new host on resuscitation. */
    host: HostPort
    /** Mutable lifecycle status; transitions via the session machine. */
    status: SessionStatus
    /** Reactive state store; never re-hydrated by this module. */
    sessionState: SessionState<S>
    /** Service registry; preserved by reference across resuscitation. */
    services: ServiceRegistryHandle
    /** Abort source; aborted only on final disposal, never on suspend. */
    abortController: AbortController
    /** Creation timestamp from the injected `now` clock. */
    createdAt: number
}

/**
 * Options for {@link suspendSession}.
 */
export interface SuspendOptions {
    /** Scheduler owning the TTL timeout. */
    scheduler: SchedulerPort
    /**
     * Time-to-live in milliseconds. `0` disposes immediately without parking;
     * `Infinity` requires `retention: 'pinned'`, otherwise a plain config
     * `Error` is thrown (the taxonomy code is owned by the application layer).
     */
    ttlMs: number
    /**
     * Retention mode. Only `'pinned'` admits `Infinity`; finite TTLs behave
     * identically under both modes in this kernel.
     */
    retention?: 'default' | 'pinned'
    /** Deterministic clock for `suspendedAt`; defaults to `Date.now`. */
    now?: () => number
}

/**
 * Handle returned by {@link suspendSession}. The `record` is the same object
 * passed in, mutated to `suspended` (or `disposed` for `ttlMs: 0`).
 */
export interface SuspendedHandle<S extends Record<PropertyKey, unknown>> {
    /** The suspended record (same reference as the input). */
    readonly record: SuspendableRecord<S>
    /** Timestamp when suspension was entered. */
    readonly suspendedAt: number
    /**
     * Cancels the pending TTL dispose. Idempotent and inert after disposal.
     */
    cancelDispose(): void
    /**
     * Forces immediate disposal now. Idempotent.
     */
    disposeNow(): void
    /**
     * Reports whether the record has reached terminal `disposed`.
     *
     * @returns True once disposal ran.
     */
    didDispose(): boolean
}

/**
 * Parks a record in `Suspended` and schedules TTL disposal via the injected
 * scheduler. `Mounted` suspends via `disconnect`; `Initializing` suspends via
 * `wait-disconnect` (the waiting-disconnect path). Suspension never poisons
 * the store and never aborts: the service plane stays alive.
 *
 * @param record Live record to suspend; mutated in place.
 * @param options Scheduler, TTL, retention, and clock.
 * @returns A handle owning the pending dispose timer.
 * @throws Plain `Error` for `Infinity` without `retention: 'pinned'`, and for
 * illegal source statuses (anything but `mounted` or `initializing`).
 * @example
 * ```ts
 * import { suspendSession } from './suspend-resuscitate.js'
 *
 * const handle = suspendSession(record, { scheduler, ttlMs: 50 })
 * ```
 */
export function suspendSession<S extends Record<PropertyKey, unknown>>(
    record: SuspendableRecord<S>,
    options: SuspendOptions,
): SuspendedHandle<S> {
    const { scheduler, ttlMs, retention = 'default' } = options
    const now = options.now ?? Date.now
    if (ttlMs === Infinity && retention !== 'pinned') {
        throw new Error('[document-context] suspensionTtlMs: Infinity requires retention: \'pinned\'')
    }
    const event = record.status === 'mounted'
        ? 'disconnect'
        : record.status === 'initializing'
            ? 'wait-disconnect'
            : null
    if (event === null) {
        throw new Error(`[document-context] Illegal suspend from status '${record.status}'`)
    }
    const suspendedAt = now()
    if (ttlMs === 0) {
        const terminal = record.status === 'mounted'
            ? transition(record.status, 'dispose', record.kind)
            : transition(record.status, 'abort', record.kind)
        record.status = terminal
        record.sessionState.poison()
        if (!record.abortController.signal.aborted) {
            record.abortController.abort()
        }
        let disposed = true
        return {
            record,
            suspendedAt,
            cancelDispose: () => {},
            disposeNow: () => {},
            didDispose: () => disposed,
        }
    }
    record.status = transition(record.status, event, record.kind)
    let disposed = false
    let cancel: (() => void) | null = null
    const disposeWith = (kind: 'ttl' | 'dispose'): void => {
        if (disposed || record.status !== 'suspended') {
            return
        }
        record.status = transition(record.status, kind, record.kind)
        disposed = true
        record.sessionState.poison()
        if (!record.abortController.signal.aborted) {
            record.abortController.abort()
        }
    }
    if (ttlMs !== Infinity) {
        cancel = scheduler.timeout(() => {
            disposeWith('ttl')
        }, ttlMs)
    }
    return {
        record,
        suspendedAt,
        cancelDispose: () => {
            if (disposed || cancel === null) {
                return
            }
            cancel()
            cancel = null
        },
        disposeNow: () => {
            if (cancel !== null) {
                cancel()
                cancel = null
            }
            disposeWith('dispose')
        },
        didDispose: () => disposed || record.status === 'disposed',
    }
}

/**
 * Returns a suspended record to `Mounted` on a new host. The same record
 * reference is preserved with identical state and services; no re-hydration
 * runs and the snapshot is never rewritten here. Any pending TTL from the
 * matching {@link suspendSession} handle is cancelled.
 *
 * @param suspended Handle returned by `suspendSession`, or the bare suspended
 * record itself (in which case any pending timer must already have been
 * cancelled by the caller).
 * @param newHost Host to rebind the record to.
 * @returns The same record, now `mounted` on the new host.
 * @throws Plain `Error` when the record is not `suspended`.
 * @example
 * ```ts
 * import { resuscitateSession } from './suspend-resuscitate.js'
 *
 * const revived = resuscitateSession(handle, newHost)
 * ```
 */
export function resuscitateSession<S extends Record<PropertyKey, unknown>>(
    suspended: SuspendedHandle<S> | SuspendableRecord<S>,
    newHost: HostPort,
): SuspendableRecord<S> {
    const record: SuspendableRecord<S> = (suspended as SuspendedHandle<S>).record ?? (suspended as SuspendableRecord<S>)
    const handle = (suspended as SuspendedHandle<S>).cancelDispose !== undefined
        ? (suspended as SuspendedHandle<S>)
        : null
    handle?.cancelDispose()
    if (record.status !== 'suspended') {
        throw new Error(`[document-context] Illegal resuscitate from status '${record.status}'`)
    }
    record.host = newHost
    record.status = transition(record.status, 'resuscitate', record.kind)
    return record
}

/**
 * Picks the oldest suspended entry for `maxSuspendedPerDocument` cap eviction.
 * Oldest means the smallest `suspendedAt`; ties resolve by input order
 * (stable oldest-first). The caller owns the full dispose path for the victim
 * (`onDispose` LIFO plus `lifecycle$ disposed` with
 * `details.evicted: 'suspended-cap'`); this helper only selects.
 *
 * @param suspendedList Suspended handles or records carrying `suspendedAt`.
 * @returns The oldest entry, or null when the list is empty.
 * @example
 * ```ts
 * import { evictOldest } from './suspend-resuscitate.js'
 *
 * const victim = evictOldest(handles)
 * victim?.disposeNow()
 * ```
 */
export function evictOldest<T extends { readonly suspendedAt: number }>(
    suspendedList: ReadonlyArray<T>,
): T | null {
    let oldest: T | null = null
    for (const entry of suspendedList) {
        if (oldest === null || entry.suspendedAt < oldest.suspendedAt) {
            oldest = entry
        }
    }
    return oldest
}
