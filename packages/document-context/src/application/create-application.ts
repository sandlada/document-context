/**
 * Application assembly: `createApplication` binds ports and context into the
 * public verb surface.
 *
 * This module performs no DOM access and starts no timers at import or
 * assembly time: it only allocates the context and closes over it. It runs
 * in a plain Node environment.
 *
 * Track ownership:
 * - A1 (landed): `./api/create-context.js` (`createContext`),
 *   `./api/pipe.js` (`pipe`, `BlueprintOperator`), `./api/provide.js`
 *   (`provide`, `provideSync`, `ProvideOptions`), `./api/hooks.js`
 *   (`onMount`, `onDispose`, `onSuspend`, `onResuscitate`, `onAdopt`).
 * - A2 (landed): `./api/mount.js` (`createMount`, `createMountSync`,
 *   `MountOptions`), `./api/dispose.js` (`createDispose`), `./api/inject.js`
 *   (`createInjection`, `Injection`, `InjectionContext`, `LateTarget`),
 *   `./api/get-session.js` (`createSessionTracking`, `SessionTracking`,
 *   `SessionTrackingContext`), `./api/select.js` (`createSelection`,
 *   `Selection`), `./api/update.js` (`createUpdate`, `UpdateFn`),
 *   `./api/subscribe.js` (`createSubscribe`, `SubscribeFn`).
 * - This track: `./context.js` (frozen `ApplicationContext`),
 *   `./api/persist.js` (`persist`), `./api/attach.js` (`createAttach`),
 *   `./api/serialize.js` (`createSerialize`).
 */

import type { ContextBlueprint, Session } from '../domain/index.js'
import type { ApplicationContext, ApplicationPorts, SerializeOptions } from './context.js'
import { createApplicationContext } from './context.js'
import { createContext } from './api/create-context.js'
import { pipe } from './api/pipe.js'
import { provide, provideSync } from './api/provide.js'
import { onAdopt, onDispose, onMount, onResuscitate, onSuspend } from './api/hooks.js'
import { persist } from './api/persist.js'
import { createAttach, type AttachConfig, type HostHooks } from './api/attach.js'
import { createSerialize } from './api/serialize.js'
import { createDispose } from './api/dispose.js'
import { createInjection, type Injection, type InjectionContext } from './api/inject.js'
import { createMount, createMountSync, type MountOptions } from './api/mount.js'
import { createSelection, type Selection } from './api/select.js'
import { createSessionTracking, type SessionTracking, type SessionTrackingContext } from './api/get-session.js'
import { createSubscribe, type SubscribeFn } from './api/subscribe.js'
import { createUpdate, type UpdateFn } from './api/update.js'

/**
 * Assembled application: the full public API surface with every verb bound
 * to one context. Blueprint operators are pure re-exports spelled `typeof`
 * so the surface matches their modules exactly; execution verbs reuse the
 * owning track's verb types (`Injection`, `Selection`, `SessionTracking`,
 * `UpdateFn`, `SubscribeFn`) so the surface matches the implementations
 * exactly.
 */
export interface Application {
    /** Seeds a blueprint from initial state. */
    readonly createContext: typeof createContext
    /** Composes blueprint operators while keeping the state shape. */
    readonly pipe: typeof pipe
    /** Registers an async service factory (first-class provider). */
    readonly provide: typeof provide
    /** Registers a sync service factory (second-class projection). */
    readonly provideSync: typeof provideSync
    /** Runs a handler on entering `Mounted`; its return is the LIFO cleanup. */
    readonly onMount: typeof onMount
    /** Runs a handler on final `Disposed` (LIFO, after cleanups). */
    readonly onDispose: typeof onDispose
    /** Runs a handler on `Mounted` to `Suspended` parking. */
    readonly onSuspend: typeof onSuspend
    /** Runs a handler on `Suspended` to `Mounted` resuscitation. */
    readonly onResuscitate: typeof onResuscitate
    /** Runs a handler on host adoption. */
    readonly onAdopt: typeof onAdopt
    /** Declares persistence for a blueprint. */
    readonly persist: typeof persist
    /** Mounts a blueprint on a host; resolves once hydrated and eager-ready. */
    readonly mount: <S extends Record<PropertyKey, unknown>, Host = HTMLElement>(blueprint: ContextBlueprint<S>, options?: MountOptions) => (element: Host) => Promise<Session<S, Host>>
    /** Mounts synchronously; throws when async work is not ready. */
    readonly mountSync: <S extends Record<PropertyKey, unknown>, Host = HTMLElement>(blueprint: ContextBlueprint<S>, options?: MountOptions) => (element: Host) => Session<S, Host>
    /** Latest mounted session along the ancestor chain, or null. */
    readonly getSessionSync: SessionTracking['getSessionSync']
    /** Hot stream tracking the latest mounted session along ancestors. */
    readonly session$: SessionTracking['session$']
    /** Synchronous state projection from a session snapshot. */
    readonly selectSync: Selection['selectSync']
    /** State projection stream from a session. */
    readonly select$: Selection['select$']
    /** Shallow-merges an updater into session state. */
    readonly update: UpdateFn
    /** Subscribes a listener to session state. */
    readonly subscribe$: SubscribeFn
    /** Disposes a session; idempotent. */
    readonly dispose: (session: Session) => void
    /** Late-binding single-value promise resolution from any target. */
    readonly inject: Injection['inject']
    /** Synchronous single-value projection from a ready session. */
    readonly injectSync: Injection['injectSync']
    /** Late-binding single-value resolve-once stream from any target. */
    readonly inject$: Injection['inject$']
    /** Late-binding multi-value promise resolution from any target. */
    readonly injectAll: Injection['injectAll']
    /** Synchronous multi-value projection from a ready session. */
    readonly injectAllSync: Injection['injectAllSync']
    /** Late-binding multi-value resolve-once stream from any target. */
    readonly injectAll$: Injection['injectAll$']
    /** Host lifecycle forwarding hooks for a session. */
    readonly attach: (config?: AttachConfig) => (session: Session) => HostHooks
    /** Session snapshot (or projection) to SSR payload string. */
    readonly serialize: <S extends Record<PropertyKey, unknown>>(options?: SerializeOptions<S>) => (session: Session<S>) => string
}

/**
 * Assembles an application from injected ports: allocates a fresh context,
 * binds every context-taking factory to it, and returns the public verb
 * surface. Pure operators pass through by reference; every application owns
 * independent session indexes, singleton slots, and a rescan channel.
 *
 * The two casts below bridge the frozen `HostSessionMap` (WeakMap-backed,
 * `get`/`set`/`delete` only) to the injection and session-tracking narrow
 * contexts (typed `ReadonlyMap`). Both factories only call `.get` at
 * runtime, so the cast is behavior-preserving; the narrow contexts should
 * widen to the frozen map shape as a follow-up.
 *
 * @param ports Host, storage, and optional SSR ports for this application.
 * @returns The bound public API surface.
 * @example
 * ```ts
 * import { createApplication } from './create-application.js'
 *
 * const app = createApplication({ host, storage })
 * const session = await app.mount(app.pipe(app.createContext({ count: 0 })))(el)
 * ```
 */
export function createApplication(ports: ApplicationPorts): Application {
    const ctx: ApplicationContext = createApplicationContext(ports)
    const mount = createMount(ctx)
    const mountSync = createMountSync(ctx)
    const { inject, injectSync, inject$, injectAll, injectAllSync, injectAll$ } = createInjection(ctx as unknown as InjectionContext)
    const { session$, getSessionSync } = createSessionTracking(ctx as unknown as SessionTrackingContext)
    const { select$, selectSync } = createSelection(ctx)
    const update = createUpdate(ctx)
    const subscribe$ = createSubscribe(ctx)
    const dispose = createDispose(ctx)
    const attach = createAttach(ctx)
    const serialize = createSerialize(ctx)
    return {
        createContext,
        pipe,
        provide,
        provideSync,
        onMount,
        onDispose,
        onSuspend,
        onResuscitate,
        onAdopt,
        persist,
        mount,
        mountSync,
        getSessionSync,
        session$,
        selectSync,
        select$,
        update,
        subscribe$,
        dispose,
        inject,
        injectSync,
        inject$,
        injectAll,
        injectAllSync,
        injectAll$,
        attach,
        serialize,
    }
}
