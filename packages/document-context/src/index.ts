/**
 * `@sandlada/document-context` — the root entry.
 *
 * The root entry carries the Phase 1 operators and the Phase 2 verbs of a **default application**.
 * The default application is assembled lazily on the first Phase 2 call, so importing this module
 * never touches a DOM global.
 *
 * @example
 * ```ts
 * import { createContext, defineToken, mount, pipe, provide, subscribe$, update } from '@sandlada/document-context'
 *
 * const countToken = defineToken<{ inc(): void }>('public')('app:count')
 * const blueprint = pipe(
 *     createContext({ count: 0 }),
 *     provide(countToken, ({ session }) => ({
 *         inc: () => update((state) => ({ ...state, count: state.count + 1 }))(session),
 *     })),
 * )
 *
 * const session = mount(blueprint)(document.getElementById('app')!)
 * await session.ready
 * subscribe$((state) => { console.log(state.count) })(session)
 * ```
 */

import type { Observable, Subscription } from 'rxjs'
import type { Blueprint } from './domain/model/blueprint'
import type { LateTarget, Session } from './domain/model/session'
import type { RegisteredService, TokenLike } from './domain/model/token'
import type { Application, AttachConfig, AttachHandle } from './application/application'
import { createApplication } from './application/application'
import type { MountOptions } from './application/api/mount'
import type { InjectOptions } from './application/api/inject'
import type { InjectAllOptions } from './application/api/inject-all'
import { createDomHostAdapter, type DomHost, type DomHostAdapter } from './infrastructure/dom/host-adapter'

// ---------------------------------------------------------------------------
// Phase 1 — pure blueprint operators. They are not bound to any application.
// ---------------------------------------------------------------------------

export { copyState, createContext, isPlainObject, pipe } from './domain/model/blueprint'
export type {
    Blueprint,
    BlueprintOperator,
    Factory,
    FactoryTools,
    HookFn,
    HookRegistration,
    HookType,
    ProviderLifecycle,
    ProviderRegistration,
} from './domain/model/blueprint'

export { defineToken, isPrivateToken, isPublicToken, validateTokenName } from './domain/model/token'
export type {
    PrivateToken,
    RegisteredService,
    ServiceRegistry,
    Token,
    TokenLike,
    TokenVisibility,
} from './domain/model/token'

export { provide } from './application/api/provide'
export type { ProvideOptions } from './application/api/provide'
export { onAdopt, onDispose, onMount, onResume, onSuspend } from './application/api/hooks'
export { merge } from './application/api/merge'

export { DocumentContextError, isDocumentContextError } from './domain/model/errors'
export type { ErrorCode } from './domain/model/errors'

export { isSession } from './domain/model/session'
export type {
    Host,
    HostEvent,
    HostEventListener,
    HostKind,
    HostListenerOptions,
    LateTarget,
    MountTarget,
    ServerHost,
    Session,
} from './domain/model/session'

export type {
    DisposalReason,
    LifecycleEvent,
    LifecycleEventType,
    SessionStatus,
} from './domain/model/lifecycle'

export type {
    ConnectivityPort,
    HostAdapter,
    SchedulerPort,
    ScopeTransportPort,
    SsrPort,
    TokensPort,
} from './domain'

// ---------------------------------------------------------------------------
// Phase 2 — verbs bound to the default application.
// ---------------------------------------------------------------------------

let defaultApplication: Application<DomHost, Element> | null = null
/** The DOM adapter created for the lazy default application, when this module owns it. */
let ownedAdapter: DomHostAdapter | null = null

/**
 * The default application.
 *
 * It is created on the first Phase 2 call so that importing this module never touches the DOM.
 *
 * @example
 * ```ts
 * import { getDefaultApplication } from '@sandlada/document-context'
 *
 * const app = getDefaultApplication()
 * console.log(typeof app.mount) // 'function'
 * ```
 *
 * @returns The default application.
 */
export function getDefaultApplication(): Application<DomHost, Element> {
    if (defaultApplication === null) {
        ownedAdapter = createDomHostAdapter()
        defaultApplication = createApplication<DomHost, Element>({ host: ownedAdapter })
    }
    return defaultApplication
}

/**
 * Replace the default application.
 *
 * @example
 * ```ts
 * import { setDefaultApplication, getDefaultApplication, createApplication, createDomHostAdapter } from '@sandlada/document-context'
 *
 * // Reset or customize the composition root
 * setDefaultApplication(createApplication({ host: createDomHostAdapter() }))
 * const app = getDefaultApplication()
 * ```
 *
 * Replacing or clearing the default application releases the previous one, so its sessions are
 * disposed. The DOM adapter created for the lazy default application is released too, which
 * removes its `context-mount` listener.
 *
 * @param application - The application to use, or `null` to rebuild it on the next call.
 */
export function setDefaultApplication(application: Application<DomHost, Element> | null): void {
    const previous = defaultApplication
    if (previous !== null && previous !== application) {
        previous.release()
        ownedAdapter?.release()
        ownedAdapter = null
    }
    defaultApplication = application
}

/**
 * Mount a blueprint on a host.
 *
 * @example
 * ```ts
 * import { createContext, mount, update, read } from '@sandlada/document-context'
 *
 * interface CounterState {
 *     count: number
 * }
 * const counterBlueprint = createContext<CounterState>({ count: 10 })
 *
 * const host = document.getElementById('counter-container')!
 * const session = mount(counterBlueprint, { token: 'app:counter-widget' })(host)
 * await session.ready
 *
 * update<CounterState>((s) => ({ count: s.count + 1 }))(session)
 * console.log(read<CounterState, number>((s) => s.count)(session)) // 11
 * ```
 *
 * @param blueprint - The blueprint to mount.
 * @param options - The mount options.
 * @returns A function that takes the mount target and returns the session.
 */
export function mount<S>(
    blueprint: Blueprint<S>,
    options?: MountOptions,
): (target: Element) => Session<S, DomHost> {
    return getDefaultApplication().mount(blueprint, options)
}

/**
 * Resolve a single dependency.
 *
 * @example
 * ```ts
 * import { createContext, defineToken, pipe, provide, mount, inject } from '@sandlada/document-context'
 *
 * interface LoggerService {
 *     log(msg: string): void
 * }
 * const loggerToken = defineToken<LoggerService>('public')('app:logger')
 *
 * const blueprint = pipe(
 *     createContext({}),
 *     provide(loggerToken, () => ({ log: (m) => console.log(`[LOG]: ${m}`) })),
 * )
 *
 * const host = document.getElementById('app-root')!
 * const childButton = document.getElementById('submit-btn')!
 * const session = mount(blueprint)(host)
 * await session.ready
 *
 * // Child component resolves service from ancestor hierarchy
 * const logger = await inject(loggerToken)(childButton)
 * logger.log('Button clicked')
 * ```
 *
 * @param token - The token to resolve.
 * @param options - The injection options.
 * @returns A function that takes the injection target.
 */
export function inject<T>(token: TokenLike<T>, options?: InjectOptions): (target: LateTarget<Element>) => Promise<T>
/**
 * Resolve a single dependency.
 *
 * @param token - The token name.
 * @param options - The injection options.
 * @returns A function that takes the injection target.
 */
export function inject<K extends string>(
    token: K,
    options?: InjectOptions,
): (target: LateTarget<Element>) => Promise<RegisteredService<K>>
/**
 * Resolve a single dependency.
 *
 * @param token - The token name.
 * @param options - The injection options.
 * @returns A function that takes the injection target.
 */
export function inject<T>(token: string, options?: InjectOptions): (target: LateTarget<Element>) => Promise<T>
export function inject(
    token: TokenLike<any> | string,
    options?: InjectOptions,
): (target: LateTarget<Element>) => Promise<any> {
    return getDefaultApplication().inject(token as TokenLike<any>, options)
}

/**
 * Resolve a single dependency as a stream.
 *
 * @example
 * ```ts
 * import { createContext, defineToken, pipe, provide, mount, inject$ } from '@sandlada/document-context'
 *
 * interface ConfigService {
 *     version: string
 * }
 * const configToken = defineToken<ConfigService>('public')('app:config')
 *
 * const blueprint = pipe(
 *     createContext({}),
 *     provide(configToken, () => ({ version: '1.0.0' })),
 * )
 *
 * const host = document.getElementById('app-root')!
 * const session = mount(blueprint)(host)
 * await session.ready
 *
 * const sub = inject$(configToken)(host).subscribe((cfg) => {
 *     console.log('App version:', cfg.version) // '1.0.0'
 * })
 * sub.unsubscribe()
 * ```
 *
 * @param token - The token to resolve.
 * @param options - The injection options.
 * @returns A function that takes the injection target.
 */
export function inject$<T>(
    token: TokenLike<T>,
    options?: InjectOptions,
): (target: LateTarget<Element>) => Observable<T>
/**
 * Resolve a single dependency as a stream.
 *
 * @param token - The token name.
 * @param options - The injection options.
 * @returns A function that takes the injection target.
 */
export function inject$<K extends string>(
    token: K,
    options?: InjectOptions,
): (target: LateTarget<Element>) => Observable<RegisteredService<K>>
/**
 * Resolve a single dependency as a stream.
 *
 * @param token - The token name.
 * @param options - The injection options.
 * @returns A function that takes the injection target.
 */
export function inject$<T>(
    token: string,
    options?: InjectOptions,
): (target: LateTarget<Element>) => Observable<T>
export function inject$(
    token: TokenLike<any> | string,
    options?: InjectOptions,
): (target: LateTarget<Element>) => Observable<any> {
    return getDefaultApplication().inject$(token as TokenLike<any>, options)
}

/**
 * Collect every multi-value provider of a token.
 *
 * @example
 * ```ts
 * import { createContext, defineToken, pipe, provide, mount, injectAll } from '@sandlada/document-context'
 *
 * interface Validator {
 *     name: string
 *     validate(val: string): boolean
 * }
 * const validatorToken = defineToken<Validator>('public')('app:validator')
 *
 * const formBlueprint = pipe(
 *     createContext({}),
 *     provide(validatorToken, () => ({ name: 'required', validate: (v) => v.length > 0 }), { multi: true }),
 *     provide(validatorToken, () => ({ name: 'email', validate: (v) => v.includes('@') }), { multi: true }),
 * )
 *
 * const formEl = document.getElementById('signup-form')!
 * const inputEl = document.getElementById('email-input')!
 * const session = mount(formBlueprint)(formEl)
 * await session.ready
 *
 * const validators = await injectAll(validatorToken)(inputEl)
 * const isValid = validators.every((v) => v.validate('user@example.com'))
 * console.log(isValid) // true
 * ```
 *
 * @param token - The token to collect.
 * @param options - The injection options.
 * @returns A function that takes the injection target.
 */
export function injectAll<T>(
    token: TokenLike<T>,
    options?: InjectAllOptions,
): (target: LateTarget<Element>) => Promise<T[]>
/**
 * Collect every multi-value provider of a token.
 *
 * @param token - The token name.
 * @param options - The injection options.
 * @returns A function that takes the injection target.
 */
export function injectAll<K extends string>(
    token: K,
    options?: InjectAllOptions,
): (target: LateTarget<Element>) => Promise<RegisteredService<K>[]>
/**
 * Collect every multi-value provider of a token.
 *
 * @param token - The token name.
 * @param options - The injection options.
 * @returns A function that takes the injection target.
 */
export function injectAll<T>(
    token: string,
    options?: InjectAllOptions,
): (target: LateTarget<Element>) => Promise<T[]>
export function injectAll(
    token: TokenLike<any> | string,
    options?: InjectAllOptions,
): (target: LateTarget<Element>) => Promise<any[]> {
    return getDefaultApplication().injectAll(token as TokenLike<any>, options)
}

/**
 * Collect every multi-value provider of a token as a stream.
 *
 * @example
 * ```ts
 * import { createContext, defineToken, pipe, provide, mount, injectAll$ } from '@sandlada/document-context'
 *
 * interface Plugin {
 *     name: string
 * }
 * const pluginToken = defineToken<Plugin>('public')('app:plugin')
 *
 * const blueprint = pipe(
 *     createContext({}),
 *     provide(pluginToken, () => ({ name: 'theme-ext' }), { multi: true }),
 * )
 *
 * const host = document.getElementById('toolbar')!
 * const session = mount(blueprint)(host)
 * await session.ready
 *
 * const sub = injectAll$(pluginToken)(host).subscribe((plugins) => {
 *     console.log('Active plugins:', plugins.map((p) => p.name))
 * })
 * sub.unsubscribe()
 * ```
 *
 * @param token - The token to collect.
 * @param options - The injection options.
 * @returns A function that takes the injection target.
 */
export function injectAll$<T>(
    token: TokenLike<T>,
    options?: InjectAllOptions,
): (target: LateTarget<Element>) => Observable<T[]>
/**
 * Collect every multi-value provider of a token as a stream.
 *
 * @param token - The token name.
 * @param options - The injection options.
 * @returns A function that takes the injection target.
 */
export function injectAll$<K extends string>(
    token: K,
    options?: InjectAllOptions,
): (target: LateTarget<Element>) => Observable<RegisteredService<K>[]>
/**
 * Collect every multi-value provider of a token as a stream.
 *
 * @param token - The token name.
 * @param options - The injection options.
 * @returns A function that takes the injection target.
 */
export function injectAll$<T>(
    token: string,
    options?: InjectAllOptions,
): (target: LateTarget<Element>) => Observable<T[]>
export function injectAll$(
    token: TokenLike<any> | string,
    options?: InjectAllOptions,
): (target: LateTarget<Element>) => Observable<any[]> {
    return getDefaultApplication().injectAll$(token as TokenLike<any>, options)
}

/**
 * Read the current snapshot of a session.
 *
 * @example
 * ```ts
 * import { createContext, mount, read } from '@sandlada/document-context'
 *
 * interface UserState {
 *     name: string
 *     unreadCount: number
 * }
 * const userBlueprint = createContext<UserState>({ name: 'Ada', unreadCount: 3 })
 *
 * const host = document.getElementById('user-badge')!
 * const session = mount(userBlueprint)(host)
 * await session.ready
 *
 * const unread = read<UserState, number>((s) => s.unreadCount)(session)
 * console.log(unread) // 3
 * ```
 *
 * @param selector - The projection applied to the snapshot.
 * @returns A function that takes the session.
 */
export function read<S, R>(selector: (state: S) => R): (session: Session<S, any>) => R {
    return getDefaultApplication().read(selector)
}

/**
 * Replace the state of a session.
 *
 * @example
 * ```ts
 * import { createContext, mount, update, read } from '@sandlada/document-context'
 *
 * interface CounterState {
 *     count: number
 * }
 * const blueprint = createContext<CounterState>({ count: 0 })
 *
 * const host = document.getElementById('counter')!
 * const session = mount(blueprint)(host)
 * await session.ready
 *
 * const ok = update<CounterState>((state) => ({ count: state.count + 1 }))(session)
 * console.log(ok) // true (returns false if session was disposed)
 * console.log(read<CounterState, number>((s) => s.count)(session)) // 1
 * ```
 *
 * @param updater - The updater. Must be synchronous.
 * @returns A function that takes the session.
 */
export function update<S>(updater: (state: S) => S): (session: Session<S, any>) => boolean {
    return getDefaultApplication().update(updater)
}

/**
 * Observe the state of a session.
 *
 * @example
 * ```ts
 * import { createContext, mount, update, subscribe$ } from '@sandlada/document-context'
 *
 * interface CounterState {
 *     count: number
 * }
 * const blueprint = createContext<CounterState>({ count: 10 })
 *
 * const host = document.getElementById('widget')!
 * const label = document.getElementById('label')!
 * const session = mount(blueprint)(host)
 * await session.ready
 *
 * const sub = subscribe$<CounterState>((state) => {
 *     label.textContent = `Count: ${state.count}`
 * })(session)
 *
 * update<CounterState>((s) => ({ count: s.count + 1 }))(session)
 * // label.textContent updated to "Count: 11"
 *
 * sub.unsubscribe()
 * ```
 *
 * @param listener - The listener.
 * @returns A function that takes the session.
 */
export function subscribe$<S>(listener: (state: S) => void): (session: Session<S, any>) => Subscription {
    return getDefaultApplication().subscribe$(listener)
}

/**
 * The nearest session of an element.
 *
 * @example
 * ```ts
 * import { createContext, mount, sessionAt } from '@sandlada/document-context'
 *
 * const blueprint = createContext({ area: 'settings' })
 * const host = document.getElementById('settings-panel')!
 * const innerButton = document.getElementById('save-btn')!
 *
 * const session = mount(blueprint)(host)
 * await session.ready
 *
 * const nearest = sessionAt(innerButton)
 * console.log(nearest === session) // true
 * ```
 *
 * @param target - The element.
 * @returns The session, or `null`.
 */
export function sessionAt(target: Element): Session<any, DomHost> | null {
    return getDefaultApplication().sessionAt(target)
}

/**
 * Track the nearest session of an element.
 *
 * @example
 * ```ts
 * import { createContext, mount, session$ } from '@sandlada/document-context'
 *
 * const blueprint = createContext({ panel: 'dashboard' })
 * const host = document.getElementById('dashboard-container')!
 * const card = document.getElementById('widget-card')!
 *
 * const session = mount(blueprint)(host)
 * await session.ready
 *
 * const sub = session$(card).subscribe((nearestSession) => {
 *     console.log('Nearest session status:', nearestSession?.status)
 * })
 * sub.unsubscribe()
 * ```
 *
 * @param target - The element.
 * @returns The observable.
 */
export function session$(target: Element): Observable<Session<any, DomHost> | null> {
    return getDefaultApplication().session$(target)
}

/**
 * Dispose a session.
 *
 * @example
 * ```ts
 * import { createContext, pipe, onDispose, mount, dispose, update } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     createContext({ active: true }),
 *     onDispose((session) => {
 *         console.log('Teardown resources for session:', session.status)
 *     }),
 * )
 *
 * const host = document.getElementById('modal-root')!
 * const session = mount(blueprint)(host)
 * await session.ready
 *
 * dispose(session)
 * console.log(session.status) // 'disposed'
 *
 * const ok = update((s: any) => ({ ...s, active: false }))(session)
 * console.log(ok) // false (updates on disposed sessions are safely rejected)
 * ```
 *
 * @param session - The session.
 */
export function dispose(session: Session<any, any>): void {
    getDefaultApplication().dispose(session)
}

/**
 * Forward connectivity facts of an existing session.
 *
 * @example
 * ```ts
 * import { createContext, mount, attach } from '@sandlada/document-context'
 *
 * const blueprint = createContext({ status: 'connected' })
 * const host = document.getElementById('custom-host')!
 * const session = mount(blueprint)(host)
 * await session.ready
 *
 * const handle = attach({
 *     onConnect: () => console.log('Host connected to DOM'),
 *     onDisconnect: () => console.log('Host disconnected from DOM'),
 * })(session)
 *
 * // Stop tracking when no longer needed
 * handle.detach()
 * ```
 *
 * @param config - The callbacks.
 * @returns A function that takes the session.
 */
export function attach(config: AttachConfig): (session: Session<any, any>) => AttachHandle {
    return getDefaultApplication().attach(config)
}
