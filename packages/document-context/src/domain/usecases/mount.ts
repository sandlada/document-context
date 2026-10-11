/**
 * Mount orchestration kernel: status machine, abort wiring, and eager
 * instantiation over the service registry.
 *
 * This module is pure orchestration over injected ports: no DOM access, no
 * real timers, no RxJS time operators. Eager factories run through the
 * injected service registry `resolveAsync` (in-flight coalescing and
 * reject-evict come from the registry); the `SchedulerPort` is retained on
 * the record for application-owned TTL and observer wiring and is not
 * consumed for timing here. Timestamps flow through the injected `now` clock.
 * It runs in a plain Node environment.
 *
 * Kernel behavior:
 * - construction enters `Initializing` with a fresh `SessionState` seeded
 *   from the blueprint initial, a fresh service registry holding every
 *   blueprint provider (factories never run at registration), a fresh
 *   `AbortController` with a hot `abort$`, and `onMountSkipped: false`;
 * - `ready` resolves to `Mounted` once every `eager` factory settles;
 *   hydration-first ordering (hydrate before eager so `selectSync` inside
 *   eager sees hydrated state) is owned by the hydrate usecase and the
 *   application mount sequence, not here;
 * - eager rejection rejects `ready` with the bare reason (no wrapping, no
 *   `errors$` push; the application routes it) and disposes the record;
 * - waiting-disconnect during init (`notifyDisconnectedDuringInit`, D-82):
 *   keyed parks in `Suspended` with `onMountSkipped: true` and resolves
 *   `ready` (no `context-mount`, no `onMount`; deferred `onMount` runs on
 *   first resuscitation), anonymous disposes and rejects `ready` with
 *   `UNCONNECTED_NODE`;
 * - waiting abort discards hydrate and eager results, runs dispose cleanup,
 *   and rejects with `signal.reason` (abort wins even in the same task as
 *   eager settlement); explicit dispose during init rejects with
 *   `DISPOSED_SESSION`.
 *
 * Deferred to the application layer: host-keyed idempotency
 * (first-blueprint-wins) and same-host in-flight coalescing, cross-host
 * `KEYED_SESSION_CONFLICT` racing, `UNCONNECTED_NODE` gating before mount,
 * `data-context-key` versus `options.token` normalization and `onConflict`,
 * `mountSync` sync-window `ASYNC_SERVICE_NOT_READY` with
 * `details.phase: 'Initializing'`, observer versus `attach` wiring,
 * `onMount` FIFO and `context-mount` versus `lifecycle$ mounted` ordering,
 * `SINGLETON_CONFLICT` routing, storage write-back batching, and the
 * two-phase dispose sequence (sync `abort$`, poison, listener teardown, LIFO
 * cleanups, then fire-and-forget async cleanups).
 */

import { Subject } from 'rxjs'
import type { Observable } from 'rxjs'
import { DocumentContextError } from '../model/errors.js'
import { transition } from '../model/lifecycle.js'
import type { SessionKind, SessionStatus } from '../model/lifecycle.js'
import { createServiceRegistry } from '../model/service.js'
import type { ServiceRegistryHandle } from '../model/service.js'
import { createSessionState } from '../model/session.js'
import type { SessionState } from '../model/session.js'
import type { ContextBlueprint } from '../model/blueprint.js'
import type { HostPort } from '../ports/host.js'
import type { SchedulerPort } from '../ports/scheduler.js'

/**
 * Ports consumed by {@link mountSession}. The scheduler is retained on the
 * record for application-owned TTL and observer wiring; this kernel schedules
 * no timeouts itself.
 */
export interface MountSessionPorts {
    /** Scheduler retained for application-owned TTL and observer wiring. */
    readonly scheduler: SchedulerPort
}

/**
 * Input for {@link mountSession}.
 */
export interface MountSessionInput<S extends Record<PropertyKey, unknown>> {
    /** Pure blueprint declaring seed state and providers. */
    readonly blueprint: ContextBlueprint<S>
    /** Host the session mounts on. */
    readonly host: HostPort
    /** Identity kind deciding suspend-versus-dispose splits. */
    readonly kind: SessionKind
    /** Normalized keyed identity, or null for anonymous sessions. */
    readonly token: string | null
    /** Injected ports. */
    readonly ports: MountSessionPorts
    /** Deterministic clock for `createdAt`; defaults to `Date.now`. */
    readonly now?: () => number
}

/**
 * Session record produced by {@link mountSession}. The same object reference
 * is preserved across suspend and resuscitation so trackers can re-emit the
 * identical object. `status` and `onMountSkipped` are mutable by the
 * lifecycle transitions in this module and its suspend sibling.
 */
export interface MountSessionRecord<S extends Record<PropertyKey, unknown>> {
    /** Session identity kind. */
    readonly kind: SessionKind
    /** Normalized keyed identity, or null for anonymous sessions. */
    readonly token: string | null
    /** Host the session is currently bound to. */
    host: HostPort
    /** Mutable lifecycle status. */
    status: SessionStatus
    /** Reactive state store seeded from the blueprint initial. */
    readonly sessionState: SessionState<S>
    /** Service registry holding every blueprint provider. */
    readonly services: ServiceRegistryHandle
    /** Abort source; aborted only on final disposal, never on suspend. */
    readonly abortController: AbortController
    /** Hot abort channel firing once on disposal. */
    readonly abort$: Observable<void>
    /** True when init disconnected (keyed) and `onMount` was deferred. */
    onMountSkipped: boolean
    /** Creation timestamp from the injected `now` clock. */
    readonly createdAt: number
    /** Retained scheduler for application-owned TTL and observer wiring. */
    readonly scheduler: SchedulerPort
}

/**
 * Result of {@link mountSession}.
 */
export interface MountSessionResult<S extends Record<PropertyKey, unknown>> {
    /** The live record (same reference across suspend and resuscitation). */
    readonly record: MountSessionRecord<S>
    /**
     * Settles when init completes: resolves on `Mounted` or keyed
     * waiting-disconnect (`Suspended`), rejects with the bare eager reason,
     * `UNCONNECTED_NODE` (anonymous waiting-disconnect), `signal.reason`
     * (abort), or `DISPOSED_SESSION` (explicit dispose).
     */
    readonly ready: Promise<void>
    /**
     * Signals that the host disconnected during init (D-82). Keyed parks in
     * `Suspended` with `onMountSkipped` and resolves `ready`; anonymous
     * disposes and rejects with `UNCONNECTED_NODE`. No-op once init settled.
     */
    notifyDisconnectedDuringInit(): void
    /**
     * Aborts a pending init: disposes the record and rejects `ready` with the
     * reason (default platform `AbortError`). No-op once disposed.
     *
     * @param reason Abort reason forwarded to `abortController.abort`.
     */
    abort(reason?: unknown): void
    /**
     * Explicitly disposes the record. During init `ready` rejects with
     * `DISPOSED_SESSION`. Idempotent.
     */
    dispose(): void
}

/**
 * Starts a mount: enters `Initializing`, registers every blueprint provider
 * without running factories, then instantiates `eager` services through the
 * service registry with the record as the session.
 *
 * @param input Blueprint, host, kind, token, ports, and clock.
 * @returns The record plus `ready` and the waiting-disconnect, abort, and
 * dispose drivers.
 * @example
 * ```ts
 * import { mountSession } from './mount.js'
 *
 * const { record, ready } = mountSession({ blueprint, host, kind: 'keyed', token: 'app:box', ports: { scheduler } })
 * await ready
 * ```
 */
export function mountSession<S extends Record<PropertyKey, unknown>>(
    input: MountSessionInput<S>,
): MountSessionResult<S> {
    const { blueprint, host, kind, token, ports } = input
    const now = input.now ?? Date.now
    const sessionState = createSessionState<S>({ ...blueprint.initial })
    const services = createServiceRegistry()
    for (const registration of blueprint.providers.values()) {
        services.register(registration)
    }
    const abortController = new AbortController()
    const abortSubject = new Subject<void>()
    const record: MountSessionRecord<S> = {
        kind,
        token,
        host,
        status: transition('blueprint', 'mount', kind),
        sessionState,
        services,
        abortController,
        abort$: abortSubject.asObservable(),
        onMountSkipped: false,
        createdAt: now(),
        scheduler: ports.scheduler,
    }

    let settleReady!: () => void
    let rejectReady!: (reason?: unknown) => void
    const ready = new Promise<void>((resolve, reject) => {
        settleReady = resolve
        rejectReady = reject
    })
    let readySettled = false
    const resolveOnce = (): void => {
        if (!readySettled) {
            readySettled = true
            settleReady()
        }
    }
    const rejectOnce = (reason?: unknown): void => {
        if (!readySettled) {
            readySettled = true
            rejectReady(reason)
        }
    }

    const disposeRecord = (): void => {
        record.sessionState.poison()
        if (!record.abortController.signal.aborted) {
            record.abortController.abort()
        }
        abortSubject.next()
        abortSubject.complete()
    }

    const eagerRegistrations = [...blueprint.providers.values()].filter((registration) => registration.eager)
    const runEager = async (): Promise<void> => {
        await Promise.resolve()
        if (eagerRegistrations.length === 0) {
            if (record.status !== 'initializing') {
                return
            }
            if (record.abortController.signal.aborted) {
                record.status = transition(record.status, 'abort', record.kind)
                disposeRecord()
                rejectOnce(record.abortController.signal.reason)
                return
            }
            record.status = transition(record.status, 'ready', record.kind)
            resolveOnce()
            return
        }
        try {
            await Promise.all(eagerRegistrations.map((registration) =>
                services.resolveAsync(registration.token, () => registration.factory(record as unknown)),
            ))
        } catch (error) {
            if (record.status !== 'initializing') {
                return
            }
            record.status = transition(record.status, 'abort', record.kind)
            disposeRecord()
            rejectOnce(error)
            return
        }
        if (record.status !== 'initializing') {
            return
        }
        if (record.abortController.signal.aborted) {
            record.status = transition(record.status, 'abort', record.kind)
            disposeRecord()
            rejectOnce(record.abortController.signal.reason)
            return
        }
        record.status = transition(record.status, 'ready', record.kind)
        resolveOnce()
    }
    void runEager().then(undefined, () => {})

    return {
        record,
        ready,
        notifyDisconnectedDuringInit: () => {
            if (record.status !== 'initializing') {
                return
            }
            record.status = transition(record.status, 'wait-disconnect', record.kind)
            if (record.kind === 'keyed') {
                record.onMountSkipped = true
                resolveOnce()
            } else {
                disposeRecord()
                rejectOnce(new DocumentContextError('UNCONNECTED_NODE', { connected: host.isConnected }))
            }
        },
        abort: (reason?: unknown) => {
            if (record.status === 'disposed') {
                return
            }
            if (record.status === 'initializing') {
                record.status = transition(record.status, 'abort', record.kind)
                if (reason !== undefined) {
                    record.abortController.abort(reason)
                } else {
                    record.abortController.abort()
                }
                record.sessionState.poison()
                abortSubject.next()
                abortSubject.complete()
                rejectOnce(record.abortController.signal.reason)
                return
            }
            if (record.status === 'mounted' || record.status === 'suspended') {
                record.status = transition(record.status, 'dispose', record.kind)
                disposeRecord()
            }
        },
        dispose: () => {
            if (record.status === 'disposed') {
                return
            }
            if (record.status === 'initializing') {
                record.status = transition(record.status, 'abort', record.kind)
                disposeRecord()
                rejectOnce(new DocumentContextError('DISPOSED_SESSION', {}))
                return
            }
            if (record.status === 'mounted' || record.status === 'suspended') {
                record.status = transition(record.status, 'dispose', record.kind)
                disposeRecord()
            }
        },
    }
}
