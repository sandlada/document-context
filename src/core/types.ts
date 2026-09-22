// Branded token marker. Never constructed at runtime; used only as a phantom brand
// so that `ServiceToken<T, Name>` is nominally distinct from plain strings.
declare const ServiceTokenBrand: unique symbol

/**
 * Branded, type-safe dependency-injection token.
 *
 * A `ServiceToken` carries its value type `T` and its lookup name `Name` at the
 * type level, so `inject(token)` can return `T` without a cast. Prefer tokens
 * over raw strings when a service is shared across bundles or teams, because
 * two strings with the same text collide while two tokens with different
 * generic arguments do not type-check as interchangeable.
 *
 * Tokens are created once with {@link createToken} and then used as the `token`
 * argument of `withProvider`, `withAsyncProvider`, `inject`, and `injectAsync`.
 *
 * @property name - Canonical lookup key. Used as the runtime Map key identity
 * via object reference, and as the human-readable name in error messages.
 * @property __type - Phantom value-type carrier. Never assigned at runtime;
 * exists only so TypeScript can infer `T` from the token.
 *
 * @example
 * ```ts
 * import { createToken, withProvider, mount, inject } from '@sandlada/document-context'
 * import type { ServiceToken } from '@sandlada/document-context'
 *
 * const LoggerToken: ServiceToken<ConsoleLogger, 'logger'> = createToken<ConsoleLogger>('logger')
 * const blueprint = pipe(
 *     createContext({ count: 0 }),
 *     withProvider(LoggerToken, () => new ConsoleLogger())
 * )
 * const session = mount(blueprint)(document.getElementById('app')!)
 * const logger = inject(LoggerToken)(session)
 * ```
 */
export interface ServiceToken<T, Name extends string = string> {
    readonly [ServiceTokenBrand]: true
    readonly name: Name
    readonly __type?: T
}

/**
 * Creates a branded {@link ServiceToken} for type-safe dependency injection.
 *
 * This is a pure factory: it allocates a fresh token object, performs no I/O,
 * and registers nothing. Each call returns a distinct object identity, so two
 * tokens created with the same `name` string are still different runtime keys.
 * Create tokens once at module scope and reuse them.
 *
 * @param name - Canonical lookup name embedded in the token and surfaced in
 * error messages (for example `UnknownServiceError`).
 * @returns A fresh branded `ServiceToken<T, Name>` whose value type `T` is
 * inferred from the generic argument.
 *
 * @example
 * ```ts
 * import { createToken } from '@sandlada/document-context'
 *
 * const AuthToken = createToken<AuthService>('auth-service')
 * const ThemeToken = createToken<'light' | 'dark'>('theme-mode')
 * ```
 */
export function createToken<T, Name extends string = string>(name: Name): ServiceToken<T, Name> {
    return { name } as ServiceToken<T, Name>
}

/**
 * Lifetime policy for a registered service.
 *
 * - `'singleton'` — one instance per page, stored in the global singleton
 *   registry and shared across every session and DOM scope.
 * - `'scoped'` — one instance per mounted session, cached on the session
 *   internals and shared by every injection within that session scope.
 * - `'transient'` — a fresh instance on every `inject()` call; never cached.
 *
 * @example
 * ```ts
 * import { withProvider } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     base,
 *     withProvider('config', () => loadConfig(), { lifecycle: 'singleton' }),
 *     withProvider('form-state', () => createFormState(), { lifecycle: 'scoped' }),
 *     withProvider('id', () => crypto.randomUUID(), { lifecycle: 'transient' })
 * )
 * ```
 */
export type ServiceLifecycle = 'singleton' | 'scoped' | 'transient'

/**
 * Immutable registration record for one service provider.
 *
 * This is a pure data structure held inside `IContextBlueprint.providers`.
 * It is created by `withProvider` / `withAsyncProvider` and consumed by the
 * `inject` / `injectAsync` resolution pipeline. Never constructed by hand in
 * application code.
 *
 * @property token - Lookup key: either a plain string or a branded
 * {@link ServiceToken}. String tokens collide by text; token objects collide
 * by object identity.
 * @property factory - Instantiation function invoked lazily on first injection
 * (or eagerly for async singletons under `mountAsync`). Receives the owning
 * session so the factory can itself call `inject` / `select`.
 * @property lifecycle - Caching policy; see {@link ServiceLifecycle}.
 * @property isAsync - `true` when the factory returns a `Promise`. Async
 * services reject synchronous `inject()` with `AsyncServiceNotReadyError` and
 * must be resolved via `injectAsync()`.
 * @property multi - Reserved multi-provider flag. When `true`, the
 * registration participates in `injectAll()` accumulation instead of
 * first-match short-circuiting.
 */
export interface IServiceRegistration<T = unknown> {
    readonly token: string | ServiceToken<T>
    readonly factory: (session: ISession<any, any>) => T | Promise<T>
    readonly lifecycle: ServiceLifecycle
    readonly isAsync: boolean
    readonly multi?: boolean | undefined
}

/**
 * Binding rule mapping one state key to one DOM property path.
 *
 * The shorthand form is a bare path string (for example `'dataset.count'`).
 * The object form adds direction-specific codecs plus the DOM event that
 * triggers DOM-to-state sync for this binding.
 *
 * @property target - DOM property path. Supported grammars: `dataset.*`,
 * `style.*`, `style.--*`, `aria-*`, `value`, `checked | disabled | readOnly`,
 * `hidden`, `elementInternals.value | elementInternals.state`, any native
 * element property, or a plain attribute name as fallback. Paths containing
 * `__proto__`, `prototype`, `constructor`, or XSS sinks (`innerHTML`,
 * `outerHTML`, `insertAdjacentHTML`, `srcdoc`, `script`, `eval`) are rejected
 * with `PropertySyncSecurityError`.
 * @property parse - Codec for the DOM-to-state direction: converts the raw
 * DOM value (always a string for dataset/attribute/style paths) back to the
 * state type. Omit for identity.
 * @property transform - Codec for the state-to-DOM direction: converts the
 * state value to a DOM-writable `string | boolean | number | null`. `null` /
 * `undefined` removes the attribute or clears the property. Omit for identity.
 * @property event - DOM event name that triggers a DOM-to-state read for this
 * binding. Falls back to the bridge-level `events` option
 * (`['input', 'change']` by default) when omitted.
 *
 * @example
 * ```ts
 * import { withBridge, parseNumber } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     createContext({ count: 0, theme: 'light' }),
 *     withBridge({
 *         properties: {
 *             count: { target: 'dataset.count', parse: parseNumber },
 *             theme: 'aria-theme'
 *         }
 *     })
 * )
 * ```
 */
export interface IBridgePropertyRule<S = any> {
    readonly target: string
    readonly parse?: ((domValue: string) => any) | undefined
    readonly transform?: ((stateValue: any) => string | boolean | number | null) | undefined
    readonly event?: string | undefined
}

/**
 * Bidirectional state-DOM synchronization options for {@link withBridge}.
 *
 * Each `withBridge()` call appends one `IBridgeOptions` entry to
 * `blueprint.bridges` and registers a mount hook that activates it. Multiple
 * entries accumulate; later entries do not replace earlier ones.
 *
 * @property properties - Map from state key to DOM path or
 * {@link IBridgePropertyRule}. Only listed keys are synchronized; unlisted
 * state stays memory-only.
 * @property events - DOM event names that trigger DOM-to-state sync.
 * Defaults to `['input', 'change']`.
 * @property batch - When not `false` (default), state-to-DOM writes are
 * coalesced into a single `queueMicrotask` flush per tick. Set to `false` for
 * synchronous writes.
 * @property conflict - Declared conflict policy for simultaneous writes.
 * Currently reserved: the runtime applies last-write-wins ordering and does
 * not yet branch on this value.
 * @property activeElementGuard - Declared focus guard flag. Currently
 * reserved: cursor preservation for text inputs is always applied via
 * `safeWriteValueWithCursor` regardless of this value.
 *
 * @example
 * ```ts
 * import { withBridge } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     createContext({ query: '' }),
 *     withBridge({
 *         properties: { query: 'value' },
 *         events: ['input'],
 *         batch: true
 *     })
 * )
 * ```
 */
export interface IBridgeOptions<S = any> {
    readonly properties: {
        readonly [K in keyof S]?: string | IBridgePropertyRule<S> | undefined
    }
    readonly events?: readonly string[] | undefined
    readonly batch?: boolean | undefined
    readonly conflict?: ('lastWriteWins' | 'statePrecedence' | 'domPrecedence') | undefined
    readonly activeElementGuard?: boolean | undefined
}

/**
 * Precedence policy for the initial hydration merge in `resolveHydratedState`.
 *
 * The three sources are always blueprint `initialState`, live DOM properties
 * (extracted via bridge paths), and persisted storage data. The strategy only
 * controls spread order, later sources winning:
 *
 * - `'storageFirst'` (default) — `{...blueprint, ...dom, ...storage}`.
 * - `'domFirst'` — `{...blueprint, ...storage, ...dom}`. Note: the current
 *   implementation treats `'merge'` identically to `'domFirst'`.
 * - `'blueprintFirst'` — `{...dom, ...storage, ...blueprint}`.
 * - `'merge'` — currently an alias of `'domFirst'`.
 *
 * @example
 * ```ts
 * import { withStorage } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     createContext({ count: 0 }),
 *     withStorage({ adapter: 'localStorage', key: 'counter', hydrationStrategy: 'domFirst' })
 * )
 * ```
 */
export type HydrationStrategy = 'storageFirst' | 'domFirst' | 'blueprintFirst' | 'merge'

/**
 * Synchronous key-value persistence adapter.
 *
 * Any object with the `getItem / setItem / removeItem` shape qualifies, so the
 * built-in `localStorage` / `sessionStorage` adapters, a custom in-memory map,
 * or an IndexedDB-backed synchronous facade can be supplied to `withStorage`.
 *
 * @example
 * ```ts
 * const memory = new Map<string, string>()
 * const adapter = {
 *     getItem: (key: string) => memory.get(key) ?? null,
 *     setItem: (key: string, value: string) => { memory.set(key, String(value)) },
 *     removeItem: (key: string) => { memory.delete(key) }
 * }
 * ```
 */
export interface IStorageAdapter<S = any> {
    getItem(key: string): string | null | S
    setItem(key: string, value: string | S): void
    removeItem(key: string): void
}

/**
 * Asynchronous key-value persistence adapter.
 *
 * Same shape as {@link IStorageAdapter} but every method returns a `Promise`.
 * Reads hydrate late (applied via `update()` after mount); writes report
 * failures to the session error stream instead of throwing.
 *
 * @example
 * ```ts
 * const idbAdapter = {
 *     getItem: async (key: string) => (await idb.get(key)) ?? null,
 *     setItem: async (key: string, value: string) => { await idb.set(key, value) },
 *     removeItem: async (key: string) => { await idb.del(key) }
 * }
 * ```
 */
export interface IAsyncStorageAdapter<S = any> {
    getItem(key: string): Promise<string | null | S>
    setItem(key: string, value: string | S): Promise<void>
    removeItem(key: string): Promise<void>
}

/**
 * State persistence and rehydration options for {@link withStorage}.
 *
 * @property adapter - `'localStorage'`, `'sessionStorage'`, or a custom
 * sync/async adapter object. String shorthands resolve to Web Storage with an
 * in-memory fallback outside the browser.
 * @property key - Storage key (and `BroadcastChannel` / Web Locks namespace
 * suffix). Unique per persisted blueprint.
 * @property hydrationStrategy - Initial merge precedence; see
 * {@link HydrationStrategy}. Defaults to `'storageFirst'`.
 * @property crossTabSync - When not `false` (default enabled), state changes
 * broadcast via `BroadcastChannel` and incoming `storage` events are applied.
 * @property version - Schema version stamped into the `{"__v", "data"}`
 * envelope. Defaults to `1`.
 * @property migrate - Migration invoked when the persisted `__v` is older
 * than `version`. Receives `(persistedState, oldVersion)` and returns the
 * partial state to hydrate.
 *
 * @example
 * ```ts
 * import { withStorage } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     createContext({ count: 0 }),
 *     withStorage({
 *         adapter: 'localStorage',
 *         key: 'counter-app',
 *         version: 2,
 *         migrate: (old, oldVersion) => ({ count: Number((old as any).count) || 0 })
 *     })
 * )
 * ```
 */
export interface IStorageOptions<S = any> {
    readonly adapter: 'localStorage' | 'sessionStorage' | IStorageAdapter<S> | IAsyncStorageAdapter<S>
    readonly key: string
    readonly hydrationStrategy?: HydrationStrategy | undefined
    readonly crossTabSync?: boolean | undefined
    readonly version?: number | undefined
    readonly migrate?: ((persistedState: unknown, oldVersion: number) => Partial<S>) | undefined
}

/**
 * Cleanup contract for lifecycle hooks.
 *
 * A hook returns either nothing or a zero-argument cleanup invoked during
 * `dispose()` in LIFO order. Async cleanups are awaited only opportunistically;
 * prefer synchronous cleanup.
 */
export type HookCleanup = void | (() => void)

/**
 * Lifecycle hook callbacks keyed by event name.
 *
 * Register entries with `withHook(event, handler)`; all five channels are
 * optional and may hold at most one handler shape each per call (multiple
 * `withHook` calls for the same event accumulate in FIFO mount order).
 *
 * @property mount - Runs after the session is cached and global mount plugins
 * have executed. May return a cleanup pushed onto the dispose stack.
 * @property dispose - Runs during `dispose()` in LIFO order, before mount
 * cleanups. Fire-and-forget async is tolerated; rejections are routed to the
 * session error stream.
 * @property suspend - Runs when a keyed (`data-context-key`) host disconnects
 * and enters the 50ms suspended window instead of being disposed immediately.
 * @property resuscitate - Runs when a suspended keyed session is reattached to
 * a new host via `resuscitateKeyedSession`. Receives `(session, newTarget)`.
 * @property adopt - Runs when a session migrates to a new `Document` (for
 * example an iframe) via `adoptSessionToDocument`. Receives
 * `(session, newDocument)`.
 *
 * @example
 * ```ts
 * import { withHook } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     base,
 *     withHook('mount', (session) => {
 *         console.log('mounted on', session.target)
 *         return () => console.log('cleaned up')
 *     }),
 *     withHook('dispose', (session) => console.log('disposed'))
 * )
 * ```
 */
export interface ILifecycleHooks<
    S extends Record<PropertyKey, any> = Record<PropertyKey, any>,
    Services = {}
> {
    readonly mount?: ((session: ISession<S, Services>) => HookCleanup | Promise<HookCleanup>) | undefined
    readonly dispose?: ((session: ISession<S, Services>) => void | Promise<void>) | undefined
    readonly suspend?: ((session: ISession<S, Services>) => void) | undefined
    readonly resuscitate?: ((session: ISession<S, Services>, newTarget: HTMLElement) => void) | undefined
    readonly adopt?: ((session: ISession<S, Services>, newDocument: Document) => void) | undefined
}

/**
 * Valid lifecycle event names. Equal to `keyof ILifecycleHooks`:
 * `'mount' | 'dispose' | 'suspend' | 'resuscitate' | 'adopt'`.
 */
export type LifecycleEventName = keyof ILifecycleHooks

/**
 * Stored lifecycle hook registration inside a blueprint.
 *
 * @property event - Event channel the handler subscribes to.
 * @property handler - Untyped handler reference; invocation is typed by the
 * `mount` / `dispose` / observer pipelines according to `event`.
 */
export interface ILifecycleHookRegistration<
    S extends Record<PropertyKey, any> = Record<PropertyKey, any>,
    Services = {}
> {
    readonly event: LifecycleEventName
    readonly handler: Function
}

/**
 * Pure, immutable blueprint: the Phase 1 declaration of state shape, service
 * providers, DOM bridges, persistence, and lifecycle hooks.
 *
 * Blueprints never touch the DOM, perform no I/O, and install no listeners.
 * Operators (`withProvider`, `withBridge`, `withStorage`, `withHook`) return a
 * new blueprint with structural sharing; `mount(blueprint)(element)` is the
 * single execution boundary that turns a blueprint into a live `ISession`.
 *
 * @property initialState - Seed state snapshot. Frozen in development builds.
 * @property providers - Service registrations keyed by string or
 * {@link ServiceToken}.
 * @property bridges - Accumulated bridge option entries, applied in order at
 * mount time.
 * @property storage - Persistence options when `withStorage` was applied.
 * @property hooks - Accumulated lifecycle hook registrations.
 *
 * @example
 * ```ts
 * import { createContext, pipe, withProvider } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     createContext({ count: 0 }),
 *     withProvider('logger', () => new ConsoleLogger())
 * )
 * ```
 */
export interface IContextBlueprint<
    S extends Record<PropertyKey, any> = Record<PropertyKey, any>,
    Services = {}
> {
    readonly initialState: Readonly<S>
    readonly providers: ReadonlyMap<string | ServiceToken<any>, IServiceRegistration<any>>
    readonly bridges: ReadonlyArray<IBridgeOptions<S>>
    readonly storage?: Readonly<IStorageOptions<S>> | undefined
    readonly hooks: ReadonlyArray<ILifecycleHookRegistration<S, Services>>
}

// Opaque session brand. Prevents structural forgery of ISession handles.
declare const SessionBrand: unique symbol

/**
 * Opaque handle to a mounted, live runtime session (Phase 2).
 *
 * Obtained only from `mount(blueprint)(element)` or `mountAsync`. Carries the
 * host element, the originating blueprint, a disposal flag, and an
 * `AbortSignal` bound to the session lifetime. State itself is never stored on
 * this object; it lives in the internal `BehaviorSubject` keyed by WeakMap.
 *
 * @property target - Host element the blueprint was mounted on.
 * @property blueprint - Originating immutable blueprint.
 * @property abortSignal - Aborts when the session is disposed; pass to `fetch`
 * or async providers for cooperative cancellation.
 * @property isDisposed - `true` after `dispose()`; subsequent `update()` calls
 * silently no-op and return `false`.
 *
 * @example
 * ```ts
 * import { mount, select, update } from '@sandlada/document-context'
 *
 * const session = mount(blueprint)(document.getElementById('counter')!)
 * const getCount = select((s) => s.count)
 * console.log(getCount(session))
 *
 * // ExplicitResourceManagement (optional)
 * {
 *     using s = mount(blueprint)(document.getElementById('x')!)
 * }
 * ```
 */
export interface ISession<
    S extends Record<PropertyKey, any> = Record<PropertyKey, any>,
    Services = {}
> {
    readonly [SessionBrand]: true
    readonly target: HTMLElement
    readonly blueprint: IContextBlueprint<S, Services>
    readonly abortSignal: AbortSignal
    readonly isDisposed: boolean
    readonly [Symbol.dispose]: () => void
    readonly [Symbol.asyncDispose]: () => Promise<void>
}

/**
 * Global service-type registry for string tokens.
 *
 * Augment this interface once per application (declaration merging) so that
 * `inject('auth-service')` returns a typed value instead of `unknown`.
 *
 * @example
 * ```ts
 * declare module '@sandlada/document-context' {
 *     interface ServiceRegistry {
 *         'auth-service': AuthService
 *         'theme-mode': 'light' | 'dark'
 *     }
 * }
 *
 * import { inject } from '@sandlada/document-context'
 *
 * const auth = inject('auth-service')(document.getElementById('login')!)
 * ```
 */
export interface ServiceRegistry {}
