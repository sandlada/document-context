/**
 * DOM infrastructure composition root: pure re-exports of the six `dom`
 * modules plus the fully wired `createDomAdapter` factory (09 §9.1).
 *
 * This module has no tests by exemption (pure re-exports plus a thin
 * composer over covered units). Composition wiring, built once per call:
 *
 * - `registry` (per-Document pending requests) is created first;
 * - `observer` (per-Document centralized `MutationObserver`) dispatches
 *   connection facts into the adapter's `notifyHost`, maps external
 *   `data-context-key` writes to `registry.wakeAll` (whole-registry
 *   re-evaluation; the observer carries no token index, so the
 *   subtree/token-bucket fast path cannot apply — correctness fallback per
 *   D-87), and maps structure batches (`childList` / connection) to
 *   `registry.wakeAll` guarded by emptiness (zero cost when no pending);
 * - `adapter` (I1a: host normalization, scheduler, scope transport,
 *   keyed-identity I/O) is composed with `sink: observer.asSink()` (every
 *   created host is tracked) and `wake: registry` (pending watches retry on
 *   `wakeSubtree` / `wakeAll`), closing the late-binding loop with no
 *   polling and no resident timers;
 * - a document-level `context-mount` listener wakes the registry on every
 *   `Mounted` entry (subtree fast path with token-bucket filter when
 *   `providedTokens` is present, subtree fallback for keyed-only legacy
 *   dispatches per 09b §9b.6, whole-registry fallback when the host cannot
 *   be resolved);
 * - session mounts announce through `bindSessionAnnouncements` (the F-track
 *   composition root calls the returned `announce` once per mount, before
 *   hydration settles).
 *
 * Scheduler split, decided and documented: the observer runs on
 * `options.scheduler` (defaulting to a `queueMicrotask` shim) while
 * `adapter.scheduler` stays adapter-owned, because `createHostAdapter`
 * accepts no scheduler injection. In production both are
 * `queueMicrotask`-backed and equivalent; deterministic tests inject a fake
 * through `options.scheduler` for observer timing and through the
 * application ports for everything else.
 */
import type { HostPort } from '../../domain/ports/host.js'
import type { SchedulerPort } from '../../domain/ports/scheduler.js'
import type { ScopeTransportPort } from '../../domain/ports/scope-transport.js'
import { createHostAdapter, notifyHost } from './host-adapter.js'
import type { HostAdapter, HostTokenIO } from './host-adapter.js'
import type { ObserverSink } from './host-adapter.js'
import { bindSessionAnnouncements, CONTEXT_MOUNT_EVENT } from './attach.js'
import { createObserver } from './observer.js'
import type { DomObserver } from './observer.js'
import { createPendingRegistry } from './late-binding.js'
import type { PendingRegistry, PendingRegistryOptions } from './late-binding.js'

export * from './host-adapter.js'
export * from './scheduler-adapter.js'
export * from './scope-transport.js'
export * from './observer.js'
export * from './late-binding.js'
export * from './attach.js'

/**
 * Options accepted by {@link createDomAdapter}. All DOM entry points stay
 * lazy: nothing observes, listens, or reads globals until a host is resolved
 * or tracked, or a wake-up fires.
 */
export interface DomAdapterOptions {
    /** Document the observer watches; defaults to the ambient document. */
    readonly document?: Document
    /** Pending-registry bound (oldest-first overflow); defaults to `1000`. */
    readonly maxPending?: number
    /** Retry batch budget per microtask; defaults to `128`. */
    readonly maxBatch?: number
    /** Dev-ledger hook; undefined (default) means zero-cost silence. */
    readonly onEvent?: PendingRegistryOptions['onEvent']
    /** Scheduler carrying the observer's microtask re-check; defaults to a
     * `queueMicrotask` shim. The adapter keeps its own scheduler (see the
     * module note on the scheduler split). */
    readonly scheduler?: Pick<SchedulerPort, 'microtask'>
}

/**
 * Composed DOM adapter surface: the I1a bundle entries plus the I1b-owned
 * observer, pending registry, sink view, announcement binder, and teardown.
 */
export interface DomAdapter {
    /**
     * Normalizes a physical node into a cached `HostPort`.
     *
     * @param node Candidate host node.
     * @returns The cached port for the node.
     */
    readonly toHost: HostAdapter['toHost']
    /** Scheduler owned by the host adapter. */
    readonly scheduler: SchedulerPort
    /** W3C Context Protocol scope transport. */
    readonly scopeTransport: ScopeTransportPort
    /** Live keyed-identity attribute I/O. */
    readonly tokens: HostTokenIO
    /** Centralized per-Document observer handle. */
    readonly observer: DomObserver
    /** Per-Document pending-request registry. */
    readonly registry: PendingRegistry
    /** Frozen sink view, already installed in the adapter. */
    readonly sink: ObserverSink
    /** Session announcement binder (call once per mount). */
    readonly announce: typeof bindSessionAnnouncements
    /** Tears down observation and drops every pending entry. Idempotent. */
    readonly dispose: () => void
}

/**
 * Composes the full DOM adapter surface: pending registry, centralized
 * observer, and the I1a host bundle wired into the late-binding loop.
 * Mount-execution factory with lazy side effects: the native observer
 * connects on the first tracked host, and the registry schedules microtasks
 * only on wake-ups. No listeners attach and nothing dispatches during the
 * call itself.
 *
 * @param options Optional document, registry bounds, dev-ledger hook, and
 * observer scheduler override.
 * @returns The composed DOM adapter surface.
 * @example
 * ```ts
 * import { createDomAdapter } from './index.js'
 *
 * const dom = createDomAdapter()
 * const host = dom.toHost(document.getElementById('app-box'))
 * const stopAnnouncing = dom.announce(session)
 * dom.dispose()
 * stopAnnouncing()
 * ```
 */
export function createDomAdapter(options: DomAdapterOptions = {}): DomAdapter {
    const registry = createPendingRegistry({
        ...(options.maxPending === undefined ? {} : { maxPending: options.maxPending }),
        ...(options.maxBatch === undefined ? {} : { maxBatch: options.maxBatch }),
        ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    })
    const wakeIfPending = (): void => {
        if (registry.size() === 0) {
            return
        }
        registry.wakeAll()
    }
    const observer = createObserver({
        ...(options.document === undefined ? {} : { document: options.document }),
        dispatch: notifyHost,
        onKeyChange: () => registry.wakeAll(),
        onStructureChange: wakeIfPending,
        ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    })
    const adapter = createHostAdapter({ sink: observer.asSink(), wake: registry })
    const resolveListenerDocument = (): Document | null => {
        if (options.document !== undefined) {
            return options.document
        }
        const ambient = (globalThis as { readonly document?: unknown }).document
        if (typeof ambient === 'object' && ambient !== null) {
            return ambient as Document
        }
        return null
    }
    const listenerDocument = resolveListenerDocument()
    const isElementNode = (node: unknown): node is Element => {
        if (typeof node !== 'object' || node === null) {
            return false
        }
        return (node as { readonly nodeType?: unknown }).nodeType === 1
    }
    const onContextMount = (event: Event): void => {
        if (registry.size() === 0) {
            return
        }
        let element: Element | null = null
        try {
            const pathSource = event as { readonly composedPath?: unknown }
            if (typeof pathSource.composedPath === 'function') {
                const path = (pathSource.composedPath as () => unknown).call(event)
                if (Array.isArray(path)) {
                    for (const node of path) {
                        if (isElementNode(node)) {
                            element = node
                            break
                        }
                    }
                }
            }
        } catch {
            element = null
        }
        if (element === null) {
            const target = (event as { readonly target?: unknown }).target
            if (isElementNode(target)) {
                element = target
            }
        }
        if (element === null) {
            registry.wakeAll()
            return
        }
        let host: HostPort<HTMLElement>
        try {
            host = adapter.toHost(element)
        } catch {
            registry.wakeAll()
            return
        }
        let providedTokens: ReadonlyArray<string> | undefined
        let detailToken: unknown
        try {
            const detail = (event as CustomEvent).detail as
                | { readonly token?: unknown, readonly providedTokens?: unknown }
                | null
                | undefined
            if (typeof detail === 'object' && detail !== null) {
                if (Array.isArray(detail.providedTokens)) {
                    providedTokens = (detail.providedTokens as Array<unknown>).filter(
                        (candidate): candidate is string => typeof candidate === 'string',
                    )
                }
                detailToken = detail.token
            }
        } catch {
            providedTokens = undefined
        }
        if (providedTokens !== undefined) {
            registry.wakeSubtree(host, providedTokens)
            return
        }
        if (typeof detailToken === 'string') {
            registry.wakeSubtree(host, [detailToken])
            registry.wakeSubtree(host)
            return
        }
        registry.wakeAll()
    }
    if (listenerDocument !== null) {
        try {
            listenerDocument.addEventListener(CONTEXT_MOUNT_EVENT, onContextMount)
        } catch {
            // Listener install is best-effort; observer and transport still work.
        }
    }
    let disposed = false
    return {
        toHost: (node: unknown): HostPort<HTMLElement> => adapter.toHost(node),
        scheduler: adapter.scheduler,
        scopeTransport: adapter.scopeTransport,
        tokens: adapter.tokens,
        observer,
        registry,
        sink: observer.asSink(),
        announce: bindSessionAnnouncements,
        dispose: (): void => {
            if (disposed) {
                return
            }
            disposed = true
            if (listenerDocument !== null) {
                try {
                    listenerDocument.removeEventListener(CONTEXT_MOUNT_EVENT, onContextMount)
                } catch {
                    // Teardown is best-effort.
                }
            }
            observer.dispose()
            registry.clear()
        },
    }
}
