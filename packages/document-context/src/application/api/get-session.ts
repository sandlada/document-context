/**
 * Session tracking verbs: a synchronous snapshot plus a hot tracker over the
 * ancestor chain. Only connected, mounted sessions are visible; initializing
 * and suspended sessions read as absent.
 *
 * Phase: runtime (application layer). The factory is pure: calling
 * `createSessionTracking` performs no I/O and installs no listeners.
 * `getSessionSync` is a pure snapshot read; `session$` subscribes to ancestor
 * host lifecycles and the application settled stream only while subscribed.
 * Side effects: none beyond those subscriptions. Idempotency: repeated
 * snapshots agree; re-emissions fire only on identity change. Lifecycle:
 * suspension reads as `null`, resuscitation re-emits the identical facade
 * object, disposal reads as `null`.
 */

import { Observable, merge } from 'rxjs'
import type { Subscription } from 'rxjs'
import { DocumentContextError, collectAncestors } from '../../domain/index.js'
import type { HostPort, MountSessionRecord, Session } from '../../domain/index.js'

/**
 * Host adapter surface consumed by session tracking: native-to-host
 * normalisation only.
 */
export interface SessionTrackingHostAdapter {
    /** Normalises a native element to its `HostPort`; throws `HOST_INVALID` for non-hosts. */
    readonly toHost: (native: unknown) => HostPort<unknown>
}

/**
 * Ports consumed by session tracking.
 */
export interface SessionTrackingPorts {
    /** Host adapter for normalisation. */
    readonly host: SessionTrackingHostAdapter
}

/**
 * One mounted session entry keyed by native host.
 */
export interface SessionTrackingEntry {
    /** Stable session facade. */
    readonly facade: Session<Record<PropertyKey, unknown>, unknown>
    /** Live session record owning lifecycle status. */
    readonly record: MountSessionRecord<Record<PropertyKey, unknown>>
}

/**
 * Structural application context consumed by session tracking. Mirrors the
 * frozen `ApplicationContext` subset this track needs; `../context.js`
 * (parallel track) is intentionally not imported so this module typechecks
 * standalone.
 */
export interface SessionTrackingContext {
    /** Adapter ports. */
    readonly ports: SessionTrackingPorts
    /** Native host to mounted session entries. */
    readonly sessions: ReadonlyMap<unknown, SessionTrackingEntry>
    /** Hot stream poked by the mount track whenever settlement may have changed visibility. */
    readonly settled$: Observable<void>
}

/**
 * Options for the hot session tracker.
 */
export interface SessionStreamOptions {
    /** Consumer cancellation; abort completes the stream. */
    readonly signal?: AbortSignal
}

/**
 * The session tracking verbs created by {@link createSessionTracking}.
 */
export interface SessionTracking {
    /**
     * Synchronous snapshot: nearest connected, mounted session along the
     * element ancestor chain, or null.
     *
     * @deprecated Second-tier projection: not part of the stable contract and
     * subject to removal. Prefer `session$` for new code.
     */
    readonly getSessionSync: <Native = unknown>(element: Native) => Session<Record<PropertyKey, unknown>, unknown> | null
    /** Hot tracker: current session immediately, then identity changes. */
    readonly session$: <Native = unknown>(
        element: Native,
        options?: SessionStreamOptions,
    ) => Observable<Session<Record<PropertyKey, unknown>, unknown> | null>
}

/**
 * Reads the nearest visible session for an element: walks the ancestor
 * chain and returns the first entry whose record is mounted on a connected
 * host. Initializing, suspended, and disposed records are invisible.
 *
 * @param ctx Session tracking context owning sessions and the host adapter.
 * @param element Native element starting the ancestor walk.
 * @returns The nearest visible session facade, or null when absent.
 * @throws DocumentContextError with code `HOST_INVALID` for non-host natives.
 * @example
 * ```ts
 * import { createSessionTracking } from './get-session.js'
 *
 * const tracking = createSessionTracking(ctx)
 * const session = tracking.getSessionSync(element)
 * console.log(session === null)
 * ```
 */
const readSnapshot = (
    ctx: SessionTrackingContext,
    element: unknown,
): Session<Record<PropertyKey, unknown>, unknown> | null => {
    const host = ctx.ports.host.toHost(element)
    const ancestors = collectAncestors(host)
    for (const ancestor of ancestors) {
        const entry = ctx.sessions.get(ancestor.native())
        if (entry === undefined) {
            continue
        }
        if (entry.record.status !== 'mounted') {
            continue
        }
        const current = entry.record.host as HostPort<unknown>
        if (!current.isConnected) {
            continue
        }
        return entry.facade
    }
    return null
}

/**
 * Creates the session tracking verbs bound to one application context.
 *
 * Phase: pure factory; no DOM, no I/O, no listeners. Purity: creating the
 * verbs never walks anything. Side effects: only `session$` subscriptions
 * attach lifecycle listeners, released on unsubscribe. Idempotency:
 * creating twice yields independent verb sets over the same context.
 * Lifecycle: verbs observe records live; disposal is observed per read.
 *
 * @param ctx Session tracking context owning ports, sessions, and settlement.
 * @returns The `{ getSessionSync, session$ }` verbs.
 * @example
 * ```ts
 * import { createSessionTracking } from './get-session.js'
 *
 * const tracking = createSessionTracking(ctx)
 * tracking.session$(element).subscribe((session) => {
 *     console.log(session === null)
 * })
 * ```
 */
export const createSessionTracking = (ctx: SessionTrackingContext): SessionTracking => {
    const getSessionSync = <Native = unknown>(element: Native): Session<Record<PropertyKey, unknown>, unknown> | null =>
        readSnapshot(ctx, element)
    const session$ = <Native = unknown>(
        element: Native,
        options?: SessionStreamOptions,
    ): Observable<Session<Record<PropertyKey, unknown>, unknown> | null> =>
        new Observable<Session<Record<PropertyKey, unknown>, unknown> | null>((subscriber) => {
            const signal = options?.signal
            if (signal?.aborted === true) {
                subscriber.complete()
                return undefined
            }
            let current: Session<Record<PropertyKey, unknown>, unknown> | null
            try {
                current = readSnapshot(ctx, element)
            } catch (error) {
                subscriber.error(error)
                return undefined
            }
            subscriber.next(current)
            let hosts: Array<HostPort<unknown>> = []
            try {
                hosts = collectAncestors(ctx.ports.host.toHost(element as unknown))
            } catch {
                hosts = []
            }
            const triggers: Array<Observable<unknown>> = []
            for (const host of hosts) {
                triggers.push(host.lifecycle$ as Observable<unknown>)
            }
            triggers.push(ctx.settled$ as Observable<unknown>)
            let inner: Subscription | null = null
            let onAbort: (() => void) | null = null
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
            if (signal !== undefined) {
                onAbort = (): void => {
                    cleanup()
                    subscriber.complete()
                }
                signal.addEventListener('abort', onAbort, { once: true })
            }
            inner = merge(...triggers).subscribe({
                next: () => {
                    let next: Session<Record<PropertyKey, unknown>, unknown> | null
                    try {
                        next = readSnapshot(ctx, element)
                    } catch {
                        return
                    }
                    if (next !== current) {
                        current = next
                        subscriber.next(next)
                    }
                },
                error: (error: unknown) => {
                    cleanup()
                    subscriber.error(error)
                },
            })
            return (): void => {
                cleanup()
            }
        })
    return { getSessionSync, session$ }
}
