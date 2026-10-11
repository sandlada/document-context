/**
 * Centralized per-Document `MutationObserver`: the connection and key-change
 * sensor behind the DOM host adapter.
 *
 * This module is infrastructure: it reads the DOM but owns no sessions,
 * answers no resolution, and settles no promises. Exactly one native
 * `MutationObserver` exists per observed `Document` (shared through a
 * module-level `WeakMap` with handle refcounting, so independent composers on
 * the same document never multiply observers). Tracked hosts are retained as
 * `WeakRef`s only — zero strong references by construction — with a
 * `FinalizationRegistry` entry per tracked host as a backstop only; the
 * primary cleanup is deref-pruning on every check pass.
 *
 * Connection changes (`connect` / `disconnect`) are detected by comparing a
 * live DOM read against a per-host snapshot inside a coalesced microtask
 * re-check (scheduled through the injected `SchedulerPort.microtask`, so a
 * synchronous remove plus re-append converges to no event). Shadow-root
 * internals: spec-compliant browsers deliver shadow mutations to the
 * document-level observer; environments that do not (happy-dom) still
 * converge through the explicit `recheck` driver. Adoption into a
 * new `Document` is reported through the explicit `recheck` driver (native
 * `adoptNode` fires no mutation records; the `adoptedCallback` forwarding
 * channel calls `recheck`). `data-context-key` writes on a tracked host's
 * own element are filtered when self-consistent (the value equals the host
 * token) and reported through `onKeyChange` otherwise — the composer maps
 * that hook to a registry wake (external-write wake per D-109).
 *
 * Dispatch is raw and single-channel: the host adapter composes this
 * observer's `dispatch` with its `attach`-forwarded events and converges them
 * idempotently (dual-channel idempotency lives in the adapter, 05 §5.4).
 *
 * The frozen sink contract is canonical in `./host-adapter.js` (I1a) and
 * imported here by type only: there is exactly one `ObserverSink`
 * declaration in the package, re-exported below for sink consumers.
 */
import type { HostLifecycleEvent, HostPort } from '../../domain/ports/host.js'
import type { SchedulerPort } from '../../domain/ports/scheduler.js'
import type { ObserverSink } from './host-adapter.js'

export type { ObserverSink } from './host-adapter.js'

/**
 * Connection-event consumer, wired by the composer to the host adapter's
 * `notifyHost`. One call per host per coalesced pass at most.
 */
export interface HostDispatch {
    /**
     * Receives a lifecycle event for a tracked host.
     *
     * @param host Tracked host whose connection or ownership changed.
     * @param event The `connect`, `disconnect`, or `adopt` fact.
     */
    (host: HostPort, event: HostLifecycleEvent): void
}

/**
 * External key-change consumer, wired by the composer to the pending
 * registry wake. Self-consistent writes (own element, value equals the host
 * token) never reach this hook.
 */
export interface KeyChangeHandler {
    /**
     * Receives an externally written key for a tracked host's own element.
     *
     * @param host Tracked host owning the mutated element.
     * @param key Post-mutation key value, or null when removed.
     */
    (host: HostPort, key: string | null): void
}

/**
 * Options accepted by {@link createObserver}. Only `dispatch` is required;
 * the observed document defaults to the ambient `globalThis.document`.
 */
export interface DomObserverOptions {
    /** Document to observe; defaults to the ambient document at call time
     * (never at import time, keeping module import DOM-free). */
    readonly document?: Document
    /** Connection-event consumer (the adapter's notify entry). */
    readonly dispatch: HostDispatch
    /** External key-change consumer (the registry wake entry); absent means
     * external key writes are observed but not forwarded. */
    readonly onKeyChange?: KeyChangeHandler
    /** Scheduler carrying the microtask re-check; defaults to a
     * `queueMicrotask` shim. Only `microtask` is consumed (D-91: observer
     * re-checks travel through the scheduler port). */
    readonly scheduler?: Pick<SchedulerPort, 'microtask'>
}

/**
 * Centralized observer handle: sink view, flow control, teardown, and the
 * explicit adoption driver.
 */
export interface DomObserver {
    /**
     * Returns the frozen sink view (`{ track, untrack }`) for adapter
     * composition. Stable identity across calls.
     *
     * @returns The sink view bound to this handle.
     */
    asSink(): ObserverSink
    /**
     * Resumes routing (reconnects interest) and schedules a convergence
     * re-check for deltas missed while suspended. Idempotent.
     */
    observe(): void
    /**
     * Pauses routing without releasing tracked hosts or snapshots. Pending
     * re-checks become no-ops; resuming converges. Idempotent.
     */
    suspend(): void
    /**
     * Releases every tracked host, detaches from the shared per-Document
     * observer, and disconnects the native observer when the last handle
     * leaves. Idempotent.
     */
    dispose(): void
    /**
     * Runs the compare pass synchronously, bypassing suspension: the
     * `adoptedCallback` forwarding path calls this after a cross-document
     * move (native adoption fires no mutation records). Narrows to one host
     * when given, else covers every tracked host.
     *
     * @param host Optional host narrowing the pass.
     */
    recheck(host?: HostPort): void
    /**
     * Counts live tracked hosts, pruning dead refs first.
     *
     * @returns The live tracked-host count.
     */
    size(): number
}

/** Spec-fixed key attribute carrying keyed session identity (09 §9.4, 05 §5.5). */
export const CONTEXT_KEY_ATTRIBUTE = 'data-context-key'

interface TrackedEntry {
    readonly ref: WeakRef<HostPort>
    readonly holder: Set<TrackedEntry>
    connected: boolean
    doc: Document | null
}

interface HandleState {
    readonly dispatch: HostDispatch
    readonly onKeyChange: KeyChangeHandler | undefined
    readonly scheduler: Pick<SchedulerPort, 'microtask'>
    readonly tracked: Set<TrackedEntry>
    active: boolean
    disposed: boolean
    checkScheduled: boolean
    requestCheck: () => void
}

interface SharedState {
    readonly doc: Document
    readonly nativeObserver: MutationObserver
    readonly handles: Set<HandleState>
    observing: boolean
}

const sharedByDocument = new WeakMap<Document, SharedState>()

const finalizeHost = typeof FinalizationRegistry === 'undefined'
    ? null
    : new FinalizationRegistry<TrackedEntry>((entry) => {
        entry.holder.delete(entry)
    })

const defaultScheduler = (): Pick<SchedulerPort, 'microtask'> => ({
    microtask: (task) => queueMicrotask(task),
})

const resolveDocument = (candidate: Document | undefined): Document => {
    if (candidate !== undefined) {
        return candidate
    }
    const ambient = (globalThis as { readonly document?: unknown }).document
    if (typeof ambient === 'object' && ambient !== null) {
        return ambient as Document
    }
    throw new Error('[document-context] createObserver requires a Document: pass { document } explicitly outside a DOM environment')
}

const readNative = (host: HostPort): Element | null => {
    let native: unknown
    try {
        native = host.native()
    } catch {
        return null
    }
    if (typeof native !== 'object' || native === null) {
        return null
    }
    return native as Element
}

const readConnected = (element: Element): boolean =>
    (element as { readonly isConnected?: unknown }).isConnected === true

const readOwnerDocument = (element: Element): Document | null => {
    const owner = (element as { readonly ownerDocument?: unknown }).ownerDocument
    return typeof owner === 'object' && owner !== null ? (owner as Document) : null
}

const readKey = (element: Element): string | null => {
    const getAttribute = (element as { readonly getAttribute?: unknown }).getAttribute
    if (typeof getAttribute !== 'function') {
        return null
    }
    try {
        const value = (getAttribute as (name: string) => unknown).call(element, CONTEXT_KEY_ATTRIBUTE)
        return typeof value === 'string' ? value : null
    } catch {
        return null
    }
}

const forgetEntry = (entry: TrackedEntry): void => {
    entry.holder.delete(entry)
    if (finalizeHost !== null) {
        finalizeHost.unregister(entry)
    }
}

const pruneHandle = (handle: HandleState): void => {
    for (const entry of [...handle.tracked]) {
        if (entry.ref.deref() === undefined) {
            forgetEntry(entry)
        }
    }
}

const compareEntry = (handle: HandleState, entry: TrackedEntry, host: HostPort): void => {
    const element = readNative(host)
    if (element === null) {
        return
    }
    const owner = readOwnerDocument(element)
    if (entry.doc !== null && owner !== null && owner !== entry.doc) {
        entry.doc = owner
        handle.dispatch(host, { type: 'adopt', owner })
    } else if (entry.doc === null && owner !== null) {
        entry.doc = owner
    }
    const connected = readConnected(element)
    if (connected !== entry.connected) {
        entry.connected = connected
        handle.dispatch(host, { type: connected ? 'connect' : 'disconnect' })
    }
}

const runCheck = (handle: HandleState): void => {
    handle.checkScheduled = false
    if (handle.disposed || !handle.active) {
        return
    }
    pruneHandle(handle)
    for (const entry of [...handle.tracked]) {
        const host = entry.ref.deref()
        if (host === undefined) {
            continue
        }
        compareEntry(handle, entry, host)
    }
}

const deliver = (shared: SharedState, records: Array<MutationRecord>): void => {
    for (const handle of shared.handles) {
        if (handle.disposed || !handle.active) {
            continue
        }
        let structure = false
        for (const record of records) {
            if (record.type === 'childList') {
                structure = true
                continue
            }
            if (record.type === 'attributes' && record.attributeName === CONTEXT_KEY_ATTRIBUTE && handle.onKeyChange !== undefined) {
                const target = record.target as unknown as { readonly getAttribute?: unknown }
                if (typeof target.getAttribute !== 'function') {
                    continue
                }
                const element = target as unknown as Element
                for (const entry of handle.tracked) {
                    const host = entry.ref.deref()
                    if (host === undefined) {
                        continue
                    }
                    if (readNative(host) !== element) {
                        continue
                    }
                    // Self-write filter (D-109): the mount's own
                    // write-back carries the host token, so a matching
                    // value is maintenance, not news. Anything else on a
                    // tracked host's own element is an external write and
                    // wakes re-evaluation through onKeyChange.
                    const key = readKey(element)
                    if (key === host.token) {
                        continue
                    }
                    handle.onKeyChange(host, key)
                }
            }
        }
        if (structure) {
            handle.requestCheck()
        }
    }
}

const updateObserving = (shared: SharedState): void => {
    let interested = false
    for (const handle of shared.handles) {
        if (!handle.disposed && handle.active && handle.tracked.size > 0) {
            interested = true
            break
        }
    }
    if (interested === shared.observing) {
        return
    }
    if (interested) {
        shared.nativeObserver.observe(shared.doc, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [CONTEXT_KEY_ATTRIBUTE],
        })
        shared.observing = true
        return
    }
    shared.nativeObserver.disconnect()
    shared.observing = false
}

/**
 * Creates a centralized observer handle for one document. Pure construction
 * except for resolving the default document and lazily starting the shared
 * native observer on first interest: calling this function never touches the
 * document tree, and module import touches no DOM globals at all (D-109
 * root safety).
 *
 * Handles on the same document share one native `MutationObserver` with
 * independent dispatch, snapshots, and suspension. Disposing the last handle
 * disconnects the native observer and releases the document entry.
 *
 * @param options Dispatch consumer plus optional document, key-change hook,
 * and scheduler override.
 * @returns The observer handle.
 * @throws Plain `Error` when no document is available and none is passed.
 * @example
 * ```ts
 * import { createObserver } from './observer.js'
 *
 * const observer = createObserver({ dispatch: (host, event) => notifyHost(host, event) })
 * observer.asSink().track(host)
 * observer.dispose()
 * ```
 */
export function createObserver(options: DomObserverOptions): DomObserver {
    const doc = resolveDocument(options.document)

    let shared = sharedByDocument.get(doc)
    if (shared === undefined) {
        const created: SharedState = {
            doc,
            nativeObserver: new MutationObserver((records) => deliver(created, records)),
            handles: new Set<HandleState>(),
            observing: false,
        }
        shared = created
        sharedByDocument.set(doc, shared)
    }
    const sharedState = shared

    const scheduler = options.scheduler ?? defaultScheduler()

    const handle: HandleState = {
        dispatch: options.dispatch,
        onKeyChange: options.onKeyChange,
        scheduler,
        tracked: new Set<TrackedEntry>(),
        active: true,
        disposed: false,
        checkScheduled: false,
        requestCheck: () => {},
    }

    const scheduleCheck = (): void => {
        if (handle.checkScheduled || handle.disposed) {
            return
        }
        handle.checkScheduled = true
        scheduler.microtask(() => runCheck(handle))
    }
    handle.requestCheck = scheduleCheck

    const sink: ObserverSink = {
        track(host: HostPort): void {
            if (handle.disposed) {
                return
            }
            for (const entry of handle.tracked) {
                if (entry.ref.deref() === host) {
                    return
                }
            }
            const element = readNative(host)
            const record: TrackedEntry = {
                ref: new WeakRef(host),
                holder: handle.tracked,
                connected: element === null ? false : readConnected(element),
                doc: element === null ? null : readOwnerDocument(element),
            }
            handle.tracked.add(record)
            if (finalizeHost !== null) {
                try {
                    finalizeHost.register(host, record, record)
                } catch {
                    // Registration is a backstop only; tracking never depends on it.
                }
            }
            updateObserving(sharedState)
        },
        untrack(host: HostPort): void {
            for (const entry of [...handle.tracked]) {
                if (entry.ref.deref() === host) {
                    forgetEntry(entry)
                }
            }
            if (!handle.disposed) {
                updateObserving(sharedState)
            }
        },
    }

    sharedState.handles.add(handle)

    const observer: DomObserver = {
        asSink(): ObserverSink {
            return sink
        },
        observe(): void {
            if (handle.disposed) {
                return
            }
            handle.active = true
            updateObserving(sharedState)
            scheduleCheck()
        },
        suspend(): void {
            handle.active = false
            updateObserving(sharedState)
        },
        dispose(): void {
            if (handle.disposed) {
                return
            }
            handle.disposed = true
            handle.active = false
            for (const entry of [...handle.tracked]) {
                forgetEntry(entry)
            }
            sharedState.handles.delete(handle)
            if (sharedState.handles.size === 0) {
                if (sharedState.observing) {
                    sharedState.nativeObserver.disconnect()
                    sharedState.observing = false
                }
                sharedByDocument.delete(sharedState.doc)
            } else {
                updateObserving(sharedState)
            }
        },
        recheck(host?: HostPort): void {
            if (handle.disposed) {
                return
            }
            pruneHandle(handle)
            for (const entry of [...handle.tracked]) {
                const candidate = entry.ref.deref()
                if (candidate === undefined) {
                    continue
                }
                if (host !== undefined && candidate !== host) {
                    continue
                }
                compareEntry(handle, entry, candidate)
            }
        },
        size(): number {
            pruneHandle(handle)
            return handle.tracked.size
        },
    }
    return observer
}
