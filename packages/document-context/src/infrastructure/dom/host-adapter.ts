/**
 * DOM host adapter: normalizes physical elements into `HostPort` handles and
 * composes the full infrastructure bundle (host, scheduler, scope transport,
 * keyed-identity tokens).
 *
 * This module uses no DOM globals itself: every node enters through
 * `toHost`, and timing plus event dispatch live in the sibling
 * scheduler/scope-transport files. The I1b observer plugs in through
 * {@link ObserverSink} (implemented in `observer.ts`, importing this type
 * only) and pushes connection events through {@link notifyHost}.
 */
import { Subject } from 'rxjs'
import { DocumentContextError } from '../../domain/model/errors.js'
import type { HostLifecycleEvent, HostPort } from '../../domain/ports/host.js'
import type { SchedulerPort } from '../../domain/ports/scheduler.js'
import type { ScopeTransportPort } from '../../domain/ports/scope-transport.js'
import { createSchedulerAdapter } from './scheduler-adapter.js'
import { createScopeTransport } from './scope-transport.js'
import type { PendingWake } from './scope-transport.js'

/**
 * Observer contract consumed by the host adapter. The I1b observer
 * implements this interface (importing the type only) to watch every
 * adapter-created host for connection, disconnection, and adoption, pushing
 * events back through {@link notifyHost}. `untrack` is for consumers
 * releasing hosts; the adapter itself only ever calls `track`.
 */
export interface ObserverSink {
    /**
     * Starts observing a host created by the adapter.
     *
     * @param host Host to observe.
     */
    track(host: HostPort): void
    /**
     * Stops observing a previously tracked host.
     *
     * @param host Host to release.
     */
    untrack(host: HostPort): void
}

/**
 * Attribute carrying the normalized keyed identity, read once at `toHost`
 * time into `HostPort.token`.
 *
 * @example
 * ```ts
 * import { HOST_KEY_ATTRIBUTE } from './host-adapter.js'
 *
 * element.setAttribute(HOST_KEY_ATTRIBUTE, 'app:box')
 * ```
 */
export const HOST_KEY_ATTRIBUTE = 'data-context-key'

/**
 * Construction options for {@link createHostAdapter}.
 */
export interface HostAdapterOptions {
    /** Observer tracking every created host; omit for untracked hosts. */
    readonly sink?: ObserverSink
    /** Wake-up source forwarded to the composed scope transport. */
    readonly wake?: PendingWake
}

/**
 * Live keyed-identity I/O over the `data-context-key` attribute.
 * Complements the `HostPort.token` snapshot taken at `toHost` time.
 */
export interface HostTokenIO {
    /**
     * Reads the current attribute value, or null when absent.
     *
     * @param host Host whose native node carries the attribute.
     * @returns The live key, or null for an anonymous host.
     */
    read(host: HostPort<HTMLElement>): string | null
    /**
     * Writes the key, or removes the attribute when given null.
     *
     * @param host Host whose native node carries the attribute.
     * @param value Next key, or null to remove the attribute.
     * @throws DocumentContextError with code `HOST_INVALID` when the native
     * node lacks the attribute API.
     */
    write(host: HostPort<HTMLElement>, value: string | null): void
}

/**
 * Composed infrastructure bundle: host normalization plus the scheduler,
 * scope transport, and keyed-identity tokens created internally.
 */
export interface HostAdapter {
    /**
     * Normalizes a physical node into a cached `HostPort`.
     *
     * @param node Candidate host node.
     * @returns The cached port for the node.
     */
    toHost(node: unknown): HostPort<HTMLElement>
    /** Scheduler created via `createSchedulerAdapter`. */
    readonly scheduler: SchedulerPort
    /** Scope transport created via `createScopeTransport`. */
    readonly scopeTransport: ScopeTransportPort
    /** Live keyed-identity attribute I/O. */
    readonly tokens: HostTokenIO
}

/**
 * Lifecycle subjects keyed by created host. Module-level so {@link notifyHost}
 * reaches hosts from every adapter instance; entries vanish with their host
 * keys.
 */
const subjects = new WeakMap<object, Subject<HostLifecycleEvent>>()

/**
 * Pushes a lifecycle event into a host created by this module. Internal:
 * the observer calls this for every sink-tracked host on connection,
 * disconnection, and adoption. Unknown hosts (never created here) are a
 * silent no-op so stray observer callbacks cannot throw.
 *
 * @param host Host created by `toHost`.
 * @param event Connection, disconnection, or adoption event to deliver.
 * @example
 * ```ts
 * import { createHostAdapter, notifyHost } from './host-adapter.js'
 *
 * const adapter = createHostAdapter()
 * const host = adapter.toHost(document.createElement('div'))
 * notifyHost(host, { type: 'connect' })
 * ```
 */
export function notifyHost(host: HostPort<unknown>, event: HostLifecycleEvent): void {
    const subject = subjects.get(host)
    if (subject === undefined) {
        return
    }
    subject.next(event)
}

/**
 * Explains why a `toHost` candidate is not a host element, or null when the
 * candidate walks, from the outside, like an `Element`: `nodeType === 1`
 * with a present `ownerDocument` and a boolean `isConnected`. Covers HTML,
 * SVG, and MathML elements across realms with no `instanceof`.
 *
 * @param candidate Candidate host node.
 * @returns The rejection reason, or null when acceptable.
 */
const hostProblem = (candidate: unknown): string | null => {
    if (candidate === null || candidate === undefined) {
        return 'nullish'
    }
    if (typeof candidate !== 'object' && typeof candidate !== 'function') {
        return 'not-an-object'
    }
    const record = candidate as Record<string, unknown>
    if (record['nodeType'] !== 1) {
        return 'wrong-node-type'
    }
    if (record['ownerDocument'] === null || record['ownerDocument'] === undefined) {
        return 'missing-owner-document'
    }
    if (typeof record['isConnected'] !== 'boolean') {
        return 'missing-is-connected'
    }
    return null
}

/**
 * Reads the keyed identity attribute leniently: missing attribute APIs yield
 * null (anonymous) instead of throwing.
 *
 * @param element Host element to read from.
 * @returns The key, or null when absent or unreadable.
 */
const readKey = (element: Element): string | null => {
    const getAttribute = (element as unknown as { readonly getAttribute?: unknown }).getAttribute
    if (typeof getAttribute !== 'function') {
        return null
    }
    const read = getAttribute as (name: string) => string | null
    return read.call(element, HOST_KEY_ATTRIBUTE)
}

/**
 * Resolves the scope parent of an element: `parentElement`, falling back to
 * the shadow host of the containing root (`getRootNode()` duck-typed with a
 * `host`), so composed trees walk through open and closed shadow roots.
 * Candidates failing the `nodeType === 1` probe are skipped to null.
 *
 * @param element Element whose scope parent is wanted.
 * @returns The parent element, or null at the scope root.
 */
const resolveParentElement = (element: Element): Element | null => {
    const link = element as unknown as { readonly parentElement?: unknown, readonly getRootNode?: unknown }
    if (link.parentElement !== null && link.parentElement !== undefined) {
        const parent = link.parentElement as { readonly nodeType?: unknown }
        if (parent.nodeType === 1) {
            return link.parentElement as Element
        }
    }
    if (typeof link.getRootNode === 'function') {
        const getRoot = link.getRootNode as (this: Element) => unknown
        const root = getRoot.call(element) as { readonly host?: unknown } | null
        if (root !== null && typeof root === 'object') {
            const host = root.host as { readonly nodeType?: unknown } | null | undefined
            if (host !== null && host !== undefined && host.nodeType === 1) {
                return host as unknown as Element
            }
        }
    }
    return null
}

/**
 * Creates the composed infrastructure bundle. `toHost` validates and caches
 * hosts per element, reporting each creation to `options.sink`; the
 * scheduler and scope transport are created internally via
 * `createSchedulerAdapter` and `createScopeTransport` (receiving
 * `options.wake`), so these three files fully compose a working `HostAdapter`
 * with the observer plugging in later through the sink.
 *
 * Pure construction: no listeners attach and nothing dispatches until the
 * caller uses a port.
 *
 * @param options Optional observer sink and late-binding wake source.
 * @returns The composed host adapter.
 * @example
 * ```ts
 * import { createHostAdapter } from './host-adapter.js'
 *
 * const adapter = createHostAdapter()
 * const host = adapter.toHost(document.createElement('div'))
 * const hit = adapter.scopeTransport.request<string>('app:theme', host)
 * console.log(hit?.value ?? 'miss')
 * ```
 */
export function createHostAdapter(options: HostAdapterOptions = {}): HostAdapter {
    const sink = options.sink
    const hosts = new WeakMap<Element, HostPort<HTMLElement>>()

    const toHost = (node: unknown): HostPort<HTMLElement> => {
        const problem = hostProblem(node)
        if (problem !== null) {
            throw new DocumentContextError('HOST_INVALID', { reason: problem })
        }
        const element = node as unknown as Element
        const cached = hosts.get(element)
        if (cached !== undefined) {
            return cached
        }
        const subject = new Subject<HostLifecycleEvent>()
        const native = element as unknown as HTMLElement
        const port: HostPort<HTMLElement> = {
            token: readKey(element),
            get isConnected(): boolean {
                return element.isConnected
            },
            get parent(): HostPort<HTMLElement> | null {
                const parentElement = resolveParentElement(element)
                if (parentElement === null) {
                    return null
                }
                return toHost(parentElement)
            },
            lifecycle$: subject.asObservable(),
            on(
                type: string,
                listener: (event: unknown) => void,
                opts: {
                    readonly capture?: boolean,
                    readonly passive?: boolean,
                    readonly once?: boolean,
                    readonly signal?: AbortSignal,
                } = {},
            ): () => void {
                if (opts.signal?.aborted === true) {
                    return () => {}
                }
                const signal = opts.signal
                let active = true
                const wrapped = (event: Event): void => {
                    listener(event)
                }
                const off = (): void => {
                    if (!active) {
                        return
                    }
                    active = false
                    element.removeEventListener(type, wrapped, opts.capture)
                    signal?.removeEventListener('abort', onAbort)
                }
                const onAbort = (): void => {
                    off()
                }
                element.addEventListener(type, wrapped, {
                    ...(opts.capture === undefined ? {} : { capture: opts.capture }),
                    ...(opts.passive === undefined ? {} : { passive: opts.passive }),
                    ...(opts.once === undefined ? {} : { once: opts.once }),
                })
                signal?.addEventListener('abort', onAbort, { once: true })
                return off
            },
            native(): HTMLElement {
                return native
            },
        }
        hosts.set(element, port)
        subjects.set(port, subject)
        sink?.track(port)
        return port
    }

    const tokens: HostTokenIO = {
        read(host: HostPort<HTMLElement>): string | null {
            return readKey(host.native() as unknown as Element)
        },
        write(host: HostPort<HTMLElement>, value: string | null): void {
            const node = host.native() as unknown as { readonly setAttribute?: unknown, readonly removeAttribute?: unknown }
            if (typeof node.setAttribute !== 'function' || typeof node.removeAttribute !== 'function') {
                throw new DocumentContextError('HOST_INVALID', { reason: 'missing-attribute-api' })
            }
            const setAttribute = node.setAttribute as (name: string, value: string) => void
            const removeAttribute = node.removeAttribute as (name: string) => void
            if (value === null) {
                removeAttribute.call(node, HOST_KEY_ATTRIBUTE)
            } else {
                setAttribute.call(node, HOST_KEY_ATTRIBUTE, value)
            }
        },
    }

    return {
        toHost,
        scheduler: createSchedulerAdapter(),
        scopeTransport: createScopeTransport({
            ...(options.wake === undefined ? {} : { wake: options.wake }),
        }),
        tokens,
    }
}
