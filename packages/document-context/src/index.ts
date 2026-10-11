/**
 * Package composition root: the default wired application plus the full
 * public verb surface.
 *
 * This module assembles one shared {@link app} via `createApplication` with
 * infrastructure-owned ports: a lazily constructed DOM adapter (host
 * normalization, scheduler, scope transport, keyed-identity tokens), the
 * lazy storage keyword registry, and a per-request-safe SSR adapter (shared
 * null host, ambient-document payload resolver degrading to null, escaping
 * serializer). Every verb except `mount`/`mountSync` passes through by
 * reference; the two mount verbs wrap the bound originals to project session
 * lifecycle onto the host through `bindSessionAnnouncements`, synthesizing
 * the already-fired initial entry so cross-bundle receivers observe the first
 * mount exactly like a resuscitation. Announcement work is best-effort and
 * never breaks a mount.
 *
 * SSR-safe import: module evaluation performs no DOM access, installs no
 * listeners, and starts no timers. The DOM adapter is constructed on first
 * host use (`ensureDom`); storage backends resolve per keyword on first
 * `resolve()`; the payload resolver reads the ambient document per call and
 * degrades to null without one. Importing this entry in plain Node (no
 * `document`) must not throw; only host-bound calls require a DOM.
 */

import { createApplication } from './application/index.js'
import type { Application, ApplicationPorts, HostAdapter, SsrAdapter } from './application/index.js'
import type { ContextBlueprint, HostPort, SchedulerPort, ScopeTransportPort, Session } from './domain/index.js'
import type { MountOptions } from './application/api/mount.js'
import { createDomAdapter } from './infrastructure/dom/index.js'
import type { DomAdapter } from './infrastructure/dom/index.js'
import { bindSessionAnnouncements, CONTEXT_MOUNT_EVENT } from './infrastructure/dom/attach.js'
import { createStorageAdapters } from './infrastructure/storage/index.js'
import { createNullHost } from './infrastructure/ssr/null-host.js'
import { createPayloadResolver } from './infrastructure/ssr/payload-resolver.js'
import type { PayloadDocument } from './infrastructure/ssr/payload-resolver.js'
import { serialize as ssrSerialize } from './infrastructure/ssr/serialize.js'

export { createApplication }
export type { Application, HostAdapter, MountOptions, SsrAdapter }
export type { LateTarget } from './application/index.js'

/**
 * Lazily constructed DOM adapter backing the shared application. Creation
 * waits for the first host-bound call so module import stays DOM-free; every
 * later call reuses the same adapter (and its centralized observer).
 *
 * @returns The shared DOM adapter.
 */
const ensureDom = (() => {
    let adapter: DomAdapter | null = null
    return (): DomAdapter => {
        if (adapter === null) {
            adapter = createDomAdapter()
        }
        return adapter
    }
})()

/**
 * Host adapter bridging the DOM bundle into the application port shape.
 * Normalization, scheduling, and scope transport delegate to the lazy DOM
 * adapter; keyed-identity I/O re-resolves the native through the adapter
 * cache (natives here always originate from a live host, so normalization
 * cannot fail on these paths).
 */
const host: HostAdapter = {
    toHost: (node: unknown): HostPort => ensureDom().toHost(node) as unknown as HostPort,
    get scheduler(): SchedulerPort {
        return ensureDom().scheduler
    },
    get scopeTransport(): ScopeTransportPort {
        return ensureDom().scopeTransport
    },
    tokens: {
        read: (native: unknown): string | null => {
            const adapter = ensureDom()
            return adapter.tokens.read(adapter.toHost(native))
        },
        write: (native: unknown, token: string | null): void => {
            const adapter = ensureDom()
            adapter.tokens.write(adapter.toHost(native), token)
        },
    },
}

/**
 * SSR adapter for the shared application: the shared connectionless null
 * host, a payload resolver bound per call to the ambient document (null
 * without one, never throwing), and the escaping session serializer.
 */
const ssr: SsrAdapter = {
    nullHost: createNullHost(),
    payloadResolver: (token: string | null): unknown | null => {
        try {
            const candidate = (globalThis as { readonly document?: unknown }).document
            if (typeof candidate !== 'object' || candidate === null) {
                return null
            }
            return createPayloadResolver(candidate as PayloadDocument)(token)
        } catch {
            return null
        }
    },
    serialize: ssrSerialize,
}

/**
 * Ports wiring the shared application to its infrastructure. Storage builds
 * no backend until the first keyword `resolve()`; host and document access
 * stay lazy per the adapters above.
 */
const ports: ApplicationPorts = {
    host,
    storage: createStorageAdapters(),
    ssr,
}

/**
 * Shared wired application: every verb bound to one context over the ports
 * above. Prefer the individual verb exports for tree-shaking; reach for
 * `app` only when the assembled surface itself must be passed around.
 *
 * @example
 * ```ts
 * import { app } from '@sandlada/document-context'
 *
 * const blueprint = app.pipe(app.createContext({ count: 0 }))
 * const session = await app.mount(blueprint)(document.getElementById('app-box'))
 * ```
 */
export const app: Application = createApplication(ports)

/**
 * Projects one session's lifecycle onto its host through the normative
 * `context-mount` / `context-dispose` channel and synthesizes the initial
 * entry: binding happens after the mount verb resolves, by which time the
 * `mounted` (or `resuscitated`, or silently parked `suspended`) entry has
 * already fired on the session stream. Suspended parks and disposed sessions
 * synthesize nothing; live sessions announce `context-mount` once, and the
 * binding carries every later entry. Best-effort: any failure (no DOM, no
 * `CustomEvent`, unreadable native, throwing dispatch) skips silently and
 * never breaks the mount.
 *
 * @param session Freshly mounted session to announce.
 */
const announceSession = (session: Session): void => {
    try {
        bindSessionAnnouncements(session)
        if (session.isDisposed || session.isSuspended) {
            return
        }
        if (typeof CustomEvent !== 'function') {
            return
        }
        let native: unknown = null
        try {
            native = session.host.native()
        } catch {
            return
        }
        if (typeof native !== 'object' || native === null) {
            return
        }
        const dispatchEvent = (native as { readonly dispatchEvent?: unknown }).dispatchEvent
        if (typeof dispatchEvent !== 'function') {
            return
        }
        try {
            (dispatchEvent as (event: Event) => void).call(
                native,
                new CustomEvent(CONTEXT_MOUNT_EVENT, {
                    detail: { token: session.token },
                    bubbles: true,
                    composed: true,
                    cancelable: false,
                }),
            )
        } catch {
            // Announcements are best-effort: the session already transitioned.
        }
    } catch {
        // Announcement wiring must never break a mount.
    }
}

/**
 * Mounts a blueprint on a host; resolves once hydrated and eager-ready, then
 * announces the session on the host (best-effort, never breaking).
 *
 * @param blueprint Pure blueprint declaring seed state and providers.
 * @param options Optional keyed identity, TTL, observer, conflict, SSR, and signal.
 * @returns Data-last mount mapping an element to its session promise.
 * @example
 * ```ts
 * import { createContext, mount, pipe } from '@sandlada/document-context'
 *
 * const session = await mount(pipe(createContext({ count: 0 })))(document.getElementById('app-box'))
 * ```
 */
export const mount = <S extends Record<PropertyKey, unknown>, Host = HTMLElement>(
    blueprint: ContextBlueprint<S>,
    options?: MountOptions,
): ((element: Host) => Promise<Session<S, Host>>) => {
    const run = app.mount<S, Host>(blueprint, options)
    return async (element: Host): Promise<Session<S, Host>> => {
        const session = await run(element)
        announceSession(session as unknown as Session)
        return session
    }
}

/**
 * Mounts synchronously; throws when async work is not ready, then announces
 * the session on the host (best-effort, never breaking).
 *
 * @param blueprint Pure blueprint declaring seed state and providers.
 * @param options Optional keyed identity, TTL, observer, conflict, and SSR payload.
 * @returns Data-last mount mapping an element to its session.
 * @example
 * ```ts
 * import { createContext, mountSync, pipe } from '@sandlada/document-context'
 *
 * const session = mountSync(pipe(createContext({ count: 0 })))(document.getElementById('app-box'))
 * ```
 */
export const mountSync = <S extends Record<PropertyKey, unknown>, Host = HTMLElement>(
    blueprint: ContextBlueprint<S>,
    options?: MountOptions,
): ((element: Host) => Session<S, Host>) => {
    const run = app.mountSync<S, Host>(blueprint, options)
    return (element: Host): Session<S, Host> => {
        const session = run(element)
        announceSession(session as unknown as Session)
        return session
    }
}

/** Seeds a blueprint from initial state. */
export const createContext = app.createContext
/** Composes blueprint operators while keeping the state shape. */
export const pipe = app.pipe
/** Registers an async service factory (first-class provider). */
export const provide = app.provide
/** Registers a sync service factory (second-class projection). */
export const provideSync = app.provideSync
/** Runs a handler on entering `Mounted`; its return is the LIFO cleanup. */
export const onMount = app.onMount
/** Runs a handler on final `Disposed` (LIFO, after cleanups). */
export const onDispose = app.onDispose
/** Runs a handler on `Mounted` to `Suspended` parking. */
export const onSuspend = app.onSuspend
/** Runs a handler on `Suspended` to `Mounted` resuscitation. */
export const onResuscitate = app.onResuscitate
/** Runs a handler on host adoption. */
export const onAdopt = app.onAdopt
/** Declares persistence for a blueprint. */
export const persist = app.persist
/** Latest mounted session along the ancestor chain, or null. */
export const getSessionSync = app.getSessionSync
/** Hot stream tracking the latest mounted session along ancestors. */
export const session$ = app.session$
/** Synchronous state projection from a session snapshot. */
export const selectSync = app.selectSync
/** State projection stream from a session. */
export const select$ = app.select$
/** Shallow-merges an updater into session state. */
export const update = app.update
/** Subscribes a listener to session state. */
export const subscribe$ = app.subscribe$
/** Disposes a session; idempotent. */
export const dispose = app.dispose
/** Late-binding single-value promise resolution from any target. */
export const inject = app.inject
/** Synchronous single-value projection from a ready session. */
export const injectSync = app.injectSync
/** Late-binding single-value resolve-once stream from any target. */
export const inject$ = app.inject$
/** Late-binding multi-value promise resolution from any target. */
export const injectAll = app.injectAll
/** Synchronous multi-value projection from a ready session. */
export const injectAllSync = app.injectAllSync
/** Late-binding multi-value resolve-once stream from any target. */
export const injectAll$ = app.injectAll$
/** Host lifecycle forwarding hooks for a session. */
export const attach = app.attach
/** Session snapshot (or projection) to SSR payload string. */
export const serialize = app.serialize
