import {
    AsyncServiceNotReadyError,
    CircularDependencyError,
    UnconnectedNodeError,
    UnknownServiceError
} from '../core/errors'
import { getInternalSession } from '../core/session-internal'
import { registerMountPlugin } from '../core/mount'
import { trackElementForGC } from './observer'
import type {
    IServiceRegistration,
    ISession,
    ServiceRegistry,
    ServiceToken
} from '../core/types'
import { ContextRequestEvent } from './events'

const globalSingletonRegistry = new Map<string | ServiceToken<any>, any>()
const resolutionStack: string[] = []
const providerRouteCache = new WeakMap<
    HTMLElement,
    Map<string | ServiceToken<any>, WeakRef<ISession<any, any>>>
>()

/**
 * Reads a `'singleton'` instance from the page-wide global registry without
 * touching the DOM.
 *
 * @param token - Service identifier.
 * @returns The cached singleton instance, or `undefined` when absent. Note: a
 * stored `undefined` value is indistinguishable from a miss.
 *
 * @example
 * ```ts
 * import { getGlobalSingleton } from '@sandlada/document-context'
 *
 * const logger = getGlobalSingleton('logger')
 * ```
 */
export function getGlobalSingleton<T = unknown>(token: string | ServiceToken<T>): T | undefined {
    return globalSingletonRegistry.get(token)
}

/**
 * Seeds or overwrites a `'singleton'` instance in the page-wide global registry.
 *
 * Singletons created via factories are cached here automatically; call this
 * directly to pre-seed test doubles, framework singletons, or values that
 * must resolve even on detached nodes.
 *
 * @param token - Service identifier.
 * @param instance - Instance to store.
 * @returns `void`.
 *
 * @example
 * ```ts
 * import { setGlobalSingleton } from '@sandlada/document-context'
 *
 * setGlobalSingleton('logger', new ConsoleLogger())
 * ```
 */
export function setGlobalSingleton<T = unknown>(
    token: string | ServiceToken<T>,
    instance: T
): void {
    globalSingletonRegistry.set(token, instance)
}

/**
 * Clears every entry in the page-wide singleton registry.
 *
 * Primarily a test-isolation helper (`afterEach(clearGlobalSingletons)`).
 * Live sessions keep their scoped caches; only future `'singleton'`
 * resolutions re-run factories.
 *
 * @returns `void`.
 *
 * @example
 * ```ts
 * import { clearGlobalSingletons } from '@sandlada/document-context'
 *
 * afterEach(() => clearGlobalSingletons())
 * ```
 */
export function clearGlobalSingletons(): void {
    globalSingletonRegistry.clear()
}

/**
 * Instantiates (or returns the cached) service for one registration record.
 *
 * Internal resolution primitive used by `inject`, `injectAll`, and the
 * `context-request` responder. Applies the lifecycle policy: `'singleton'`
 * consults and populates the global registry, `'scoped'` consults and
 * populates the session internals, `'transient'` always invokes the factory.
 * Guards re-entrant factories with the shared `resolutionStack` and throws
 * `CircularDependencyError` on cycles. Async registrations never resolve here:
 * a cached async value is returned when present, otherwise
 * `AsyncServiceNotReadyError` is thrown and callers must use `injectAsync()`.
 *
 * @param registration - Registration record from `blueprint.providers`.
 * @param session - Owning session passed to the factory.
 * @returns The resolved (or cached) service instance.
 * @throws {AsyncServiceNotReadyError} When the registration is async and
 * uncached.
 * @throws {CircularDependencyError} When the factory re-enters its own token.
 *
 * @example
 * ```ts
 * import { resolveServiceInstance } from '@sandlada/document-context'
 *
 * const reg = session.blueprint.providers.get('logger')!
 * const logger = resolveServiceInstance(reg, session)
 * ```
 */
export function resolveServiceInstance<T = unknown>(
    registration: IServiceRegistration<T>,
    session: ISession<any, any>
): T {
    const tokenKey =
        typeof registration.token === 'object'
            ? registration.token.name
            : String(registration.token)

    // Async Service Check
    if (registration.isAsync) {
        const internal = getInternalSession(session)
        if (internal && internal.scopedServices.has(registration.token)) {
            return internal.scopedServices.get(registration.token)
        }
        if (globalSingletonRegistry.has(registration.token)) {
            return globalSingletonRegistry.get(registration.token)
        }
        throw new AsyncServiceNotReadyError({
            token: tokenKey,
            details: { token: tokenKey },
            resolutionGuide: `Service "${tokenKey}" was registered asynchronously. Use injectAsync() instead of synchronous inject().`
        })
    }

    const existingIndex = resolutionStack.indexOf(tokenKey)
    if (existingIndex !== -1) {
        const cycle = [...resolutionStack.slice(existingIndex), tokenKey]
        throw new CircularDependencyError({
            dependencyPath: cycle,
            details: { token: tokenKey },
            resolutionGuide: `Break circular reference loop: ${cycle.join(' -> ')}`
        })
    }

    if (registration.lifecycle === 'singleton') {
        if (globalSingletonRegistry.has(registration.token)) {
            return globalSingletonRegistry.get(registration.token)
        }
        resolutionStack.push(tokenKey)
        try {
            const instance = registration.factory(session) as T
            globalSingletonRegistry.set(registration.token, instance)
            return instance
        } finally {
            resolutionStack.pop()
        }
    }

    if (registration.lifecycle === 'scoped') {
        const internal = getInternalSession(session)
        if (internal && internal.scopedServices.has(registration.token)) {
            return internal.scopedServices.get(registration.token)
        }
        resolutionStack.push(tokenKey)
        try {
            const instance = registration.factory(session) as T
            if (internal) {
                internal.scopedServices.set(registration.token, instance)
            }
            return instance
        } finally {
            resolutionStack.pop()
        }
    }

    // Transient
    resolutionStack.push(tokenKey)
    try {
        return registration.factory(session) as T
    } finally {
        resolutionStack.pop()
    }
}

/**
 * Attaches the W3C `context-request` responder to a mounted host element.
 *
 * Internal mount-plugin helper (auto-registered via `registerMountPlugin`):
 * listens for bubbling `ContextRequestEvent`s from descendants, resolves the
 * requested token against this session, and invokes `event.detail.callback`.
 * Sync providers resolve via `resolveServiceInstance()`; async providers
 * answer from cache or invoke the factory without awaiting (streaming state
 * keys additionally subscribe to the session subject). Non-`multi` answers
 * call `stopPropagation()` so the nearest provider wins; `multi` answers let
 * the event keep bubbling for `injectAll()` accumulation.
 *
 * @param element - Host element owning `session`.
 * @param session - Mounted session whose providers answer requests.
 * @returns A cleanup removing the listener and unsubscribing all streaming
 * callbacks opened by this responder.
 */
export function setupProviderResponder(
    element: HTMLElement,
    session: ISession<any, any>
): () => void {
    const activeStreamSubs: Array<() => void> = []

    const handler = (e: Event) => {
        if (!(e instanceof ContextRequestEvent)) {
            return
        }

        const requestedToken = e.detail.context
        const reg = session.blueprint.providers.get(requestedToken)
        const isStreaming = Boolean(e.detail.subscribe)

        if (reg) {
            try {
                if (!reg.isAsync) {
                    const instance = resolveServiceInstance(reg, session)
                    if (isStreaming) {
                        const internal = getInternalSession(session)
                        let sub: { unsubscribe: () => void } | undefined
                        if (internal) {
                            sub = internal.stateSubject.subscribe((state) => {
                                const tokenStr =
                                    typeof requestedToken === 'object'
                                        ? requestedToken.name
                                        : String(requestedToken)
                                const val = (state as any)[tokenStr] ?? instance
                                e.detail.callback(val, () => sub?.unsubscribe())
                            })
                            const unsub = () => {
                                sub?.unsubscribe()
                            }
                            activeStreamSubs.push(unsub)
                            e.detail.callback(instance, unsub)
                        } else {
                            e.detail.callback(instance)
                        }
                    } else {
                        e.detail.callback(instance)
                    }
                } else {
                    const internal = getInternalSession(session)
                    if (internal && internal.scopedServices.has(reg.token)) {
                        e.detail.callback(internal.scopedServices.get(reg.token))
                    } else if (globalSingletonRegistry.has(reg.token)) {
                        e.detail.callback(globalSingletonRegistry.get(reg.token))
                    } else {
                        e.detail.callback(reg.factory(session))
                    }
                }
                if (!e.detail.multi) {
                    e.stopPropagation()
                }
            } catch (err) {
                throw err
            }
        } else if (isStreaming) {
            // Check if state holds the requested token
            const tokenStr =
                typeof requestedToken === 'object'
                    ? requestedToken.name
                    : String(requestedToken)
            const internal = getInternalSession(session)
            if (internal && tokenStr in internal.stateSubject.getValue()) {
                const sub = internal.stateSubject.subscribe((state) => {
                    const val = (state as any)[tokenStr]
                    e.detail.callback(val, () => sub.unsubscribe())
                })
                const unsub = () => {
                    sub.unsubscribe()
                }
                activeStreamSubs.push(unsub)
                if (!e.detail.multi) {
                    e.stopPropagation()
                }
            }
        }
    }

    element.addEventListener('context-request', handler)
    return () => {
        element.removeEventListener('context-request', handler)
        for (const unsub of activeStreamSubs) {
            unsub()
        }
    }
}

// Auto-register DOM mount plugin
registerMountPlugin((session) => {
    trackElementForGC(session.target, session)
    return setupProviderResponder(session.target, session)
})

/**
 * Curried synchronous injection over the `ServiceRegistry` string-token map.
 *
 * Typed overload: `token` must be a key of the globally augmented
 * `ServiceRegistry`, and the resolved value is `ServiceRegistry[K]`. Use this
 * overload for application services declared via `declare module`
 * augmentation.
 *
 * @param token - Augmented registry key.
 * @returns Curried resolver `(elementOrSession) => ServiceRegistry[K]`.
 *
 * @example
 * ```ts
 * declare module '@sandlada/document-context' {
 *     interface ServiceRegistry { 'auth-service': AuthService }
 * }
 * const auth = inject('auth-service')(document.getElementById('login')!)
 * ```
 */
export function inject<K extends keyof ServiceRegistry>(
    token: K
): (target: ISession<any, any> | HTMLElement) => ServiceRegistry[K]
/**
 * Curried synchronous injection over a branded {@link ServiceToken}.
 *
 * Typed overload: the resolved value is the token's phantom type `T`,
 * inferred from `ServiceToken<T>`. Prefer over strings for cross-bundle
 * services where name collisions are a risk.
 *
 * @param token - Branded token created by `createToken<T>()`.
 * @returns Curried resolver `(elementOrSession) => T`.
 *
 * @example
 * ```ts
 * const logger = inject(LoggerToken)(session)
 * ```
 */
export function inject<T>(
    token: ServiceToken<T>
): (target: ISession<any, any> | HTMLElement) => T
/**
 * Curried synchronous injection over an untyped string token.
 *
 * Fallback overload for ad-hoc or unregistered keys; the caller supplies `T`
 * explicitly. For typed lookups, augment `ServiceRegistry` or use a branded
 * `ServiceToken` instead.
 *
 * @param token - Arbitrary string key.
 * @returns Curried resolver `(elementOrSession) => T` (default `unknown`).
 *
 * @example
 * ```ts
 * const theme = inject<'light' | 'dark'>('theme-mode')(childEl)
 * ```
 */
export function inject<T = unknown>(
    token: string
): (target: ISession<any, any> | HTMLElement) => T
/**
 * Curried synchronous dependency injection verb.
 *
 * Resolves `token` against an `ISession` directly (local providers first,
 * then delegating to the session host element) or against an `HTMLElement`
 * by dispatching a synchronous `ContextRequestEvent` that bubbles up the DOM
 * tree: route-cache fast path → ancestor provider → global singleton →
 * `UnknownServiceError`. Detached nodes throw `UnconnectedNodeError` unless
 * the token is already a cached global singleton. Async providers throw
 * `AsyncServiceNotReadyError` unless already cached; use `injectAsync()`.
 *
 * @param token - Service identifier (registry key, branded token, or string).
 * @returns Curried function accepting an `ISession` or connected
 * `HTMLElement` and returning the resolved instance.
 * @throws {UnconnectedNodeError} When the target is detached and uncached.
 * @throws {UnknownServiceError} When no provider answers.
 * @throws {AsyncServiceNotReadyError} When the provider is async and uncached.
 * @throws {CircularDependencyError} When factories form a cycle.
 *
 * @example
 * ```ts
 * import { inject } from '@sandlada/document-context'
 *
 * const useLogger = inject('logger')
 * const logger = useLogger(session)
 * const nested = useLogger(document.getElementById('child')!)
 * ```
 */
export function inject(token: any): (target: ISession<any, any> | HTMLElement) => any {
    return (target: ISession<any, any> | HTMLElement): any => {
        // 1. If target is ISession, check local providers first
        if ('blueprint' in target && 'target' in target) {
            const session = target as ISession<any, any>
            const localReg = session.blueprint.providers.get(token)
            if (localReg) {
                return resolveServiceInstance(localReg, session)
            }
            return inject(token)(session.target)
        }

        const element = target as HTMLElement

        // 2. Validate node.isConnected
        if (!element.isConnected) {
            if (globalSingletonRegistry.has(token)) {
                return globalSingletonRegistry.get(token)
            }
            throw new UnconnectedNodeError({
                token: typeof token === 'object' ? token.name : String(token),
                targetNode: element,
                details: { tagName: element.tagName?.toLowerCase() },
                resolutionGuide: 'Ensure element is connected to DOM tree (isConnected === true) or use connectedCallback().'
            })
        }

        // 3. Fast Route Cache Check
        const elCache = providerRouteCache.get(element)
        const cachedProviderRef = elCache?.get(token)
        const cachedSession = cachedProviderRef?.deref()
        if (
            cachedSession &&
            !cachedSession.isDisposed &&
            cachedSession.target.isConnected &&
            cachedSession.target.contains(element)
        ) {
            const reg = cachedSession.blueprint.providers.get(token)
            if (reg) {
                return resolveServiceInstance(reg, cachedSession)
            }
        }

        // 4. Dispatch synchronous ContextRequestEvent bubbling up DOM tree
        let resolved = false
        let resolvedValue: any
        const event = new ContextRequestEvent(token, (value) => {
            resolved = true
            resolvedValue = value
        })

        element.dispatchEvent(event)

        if (resolved) {
            return resolvedValue
        }

        // 5. Fallback to global singletons
        if (globalSingletonRegistry.has(token)) {
            return globalSingletonRegistry.get(token)
        }

        const tokenName = typeof token === 'object' ? token.name : String(token)
        throw new UnknownServiceError({
            token: tokenName,
            targetElement: element.tagName?.toLowerCase() ?? 'unknown',
            details: { token: tokenName },
            resolutionGuide: `Register a provider for token "${tokenName}" using withProvider() on a parent context.`
        })
    }
}
