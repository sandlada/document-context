import {
    AsyncServiceNotReadyError,
    CircularDependencyError,
    UnconnectedNodeError,
    UnknownServiceError
} from '../core/errors'
import { getInternalSession } from '../core/session-internal'
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

export function getGlobalSingleton<T = unknown>(token: string | ServiceToken<T>): T | undefined {
    return globalSingletonRegistry.get(token)
}

export function setGlobalSingleton<T = unknown>(
    token: string | ServiceToken<T>,
    instance: T
): void {
    globalSingletonRegistry.set(token, instance)
}

export function clearGlobalSingletons(): void {
    globalSingletonRegistry.clear()
}

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
 * Attaches the W3C context-request event listener to a mounted host element.
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

/**
 * Curried synchronous dependency injection verb.
 * Resolves a service token from an ISession or an HTMLElement via the W3C Context Protocol.
 *
 * @param token The service identifier.
 * @returns Curried function accepting an ISession or HTMLElement.
 */
export function inject<K extends keyof ServiceRegistry>(
    token: K
): (target: ISession<any, any> | HTMLElement) => ServiceRegistry[K]
export function inject<T>(
    token: ServiceToken<T>
): (target: ISession<any, any> | HTMLElement) => T
export function inject<T = unknown>(
    token: string
): (target: ISession<any, any> | HTMLElement) => T
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
