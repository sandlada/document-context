import {
    CircularDependencyError,
    UnconnectedNodeError,
    UnknownServiceError
} from '../core/errors'
import {
    getElementSession,
    getInternalSession
} from '../core/session-internal'
import type {
    IServiceRegistration,
    ISession,
    ServiceRegistry,
    ServiceToken
} from '../core/types'
import { getGlobalSingleton, setGlobalSingleton } from './inject'

const asyncResolutionStack: string[] = []
const globalInFlightMap = new Map<string | ServiceToken<any>, Promise<any>>()

export interface IInjectAsyncOptions {
    readonly signal?: AbortSignal | undefined
}

function findProviderHost(
    element: HTMLElement,
    token: string | ServiceToken<any>
): { session: ISession<any, any>; registration: IServiceRegistration<any> } | null {
    let current: HTMLElement | null = element
    while (current) {
        const session = getElementSession(current)
        if (session && !session.isDisposed) {
            const reg = session.blueprint.providers.get(token)
            if (reg) {
                return { session, registration: reg }
            }
        }
        current = current.parentElement
    }
    return null
}

/**
 * Curried asynchronous dependency injection verb with Promise Coalescing,
 * self-healing cache eviction, and multi-caller abort isolation.
 *
 * @param token The service identifier.
 * @param options Optional configuration including AbortSignal.
 * @returns Curried function accepting an ISession or HTMLElement, returning a Promise.
 */
export function injectAsync<K extends keyof ServiceRegistry>(
    token: K,
    options?: IInjectAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<Awaited<ServiceRegistry[K]>>
export function injectAsync<T>(
    token: ServiceToken<T>,
    options?: IInjectAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<T>
export function injectAsync<T = unknown>(
    token: string,
    options?: IInjectAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<T>
export function injectAsync(
    token: any,
    options?: IInjectAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<any> {
    return async (target: ISession<any, any> | HTMLElement): Promise<any> => {
        let session: ISession<any, any> | undefined
        let registration: IServiceRegistration<any> | undefined

        if ('blueprint' in target && 'target' in target) {
            session = target as ISession<any, any>
            registration = session.blueprint.providers.get(token)
        } else {
            const el = target as HTMLElement
            if (!el.isConnected) {
                const globalVal = getGlobalSingleton(token)
                if (globalVal !== undefined) {
                    return globalVal
                }
                throw new UnconnectedNodeError({
                    token: typeof token === 'object' ? token.name : String(token),
                    targetNode: el,
                    details: { tagName: el.tagName?.toLowerCase() },
                    resolutionGuide: 'Ensure element is connected to DOM before calling injectAsync.'
                })
            }
            const found = findProviderHost(el, token)
            if (found) {
                session = found.session
                registration = found.registration
            }
        }

        const tokenKey =
            typeof token === 'object' ? token.name : String(token)

        // 1. Check if already resolved and cached
        if (registration?.lifecycle === 'singleton') {
            const cachedGlobal = getGlobalSingleton(token)
            if (cachedGlobal !== undefined) {
                return cachedGlobal
            }
        }

        if (session) {
            const internal = getInternalSession(session)
            if (internal && internal.scopedServices.has(token)) {
                return internal.scopedServices.get(token)
            }
        }

        if (!registration || !session) {
            const globalVal = getGlobalSingleton(token)
            if (globalVal !== undefined) {
                return globalVal
            }
            throw new UnknownServiceError({
                token: tokenKey,
                targetElement:
                    'target' in target
                        ? (target as any).target?.tagName?.toLowerCase()
                        : (target as any).tagName?.toLowerCase(),
                details: { token: tokenKey },
                resolutionGuide: `Register an async provider for "${tokenKey}" using withAsyncProvider().`
            })
        }

        const internal = getInternalSession(session)
        const inFlightMap = internal?.inFlightAsyncServices ?? globalInFlightMap

        // 2. Promise Coalescing check FIRST
        let inFlightPromise = inFlightMap.get(token)

        if (!inFlightPromise) {
            // Circular dependency check
            const cycleIndex = asyncResolutionStack.indexOf(tokenKey)
            if (cycleIndex !== -1) {
                const cycle = [...asyncResolutionStack.slice(cycleIndex), tokenKey]
                throw new CircularDependencyError({
                    dependencyPath: cycle,
                    details: { token: tokenKey },
                    resolutionGuide: `Break async circular dependency cycle: ${cycle.join(' -> ')}`
                })
            }

            inFlightPromise = (async () => {
                asyncResolutionStack.push(tokenKey)
                try {
                    const result = await registration!.factory(session!)
                    if (registration!.lifecycle === 'singleton') {
                        setGlobalSingleton(token, result)
                    } else if (registration!.lifecycle === 'scoped' && internal) {
                        internal.scopedServices.set(token, result)
                    }
                    return result
                } finally {
                    const idx = asyncResolutionStack.indexOf(tokenKey)
                    if (idx !== -1) {
                        asyncResolutionStack.splice(idx, 1)
                    }
                    inFlightMap.delete(token)
                }
            })()

            // Self-healing: clear cache immediately upon rejection
            inFlightPromise.catch(() => {
                inFlightMap.delete(token)
            })

            inFlightMap.set(token, inFlightPromise)
        }

        // 3. Multi-caller abort isolation
        if (options?.signal) {
            const signal = options.signal
            if (signal.aborted) {
                return Promise.reject(new DOMException('Aborted', 'AbortError'))
            }

            return new Promise((resolve, reject) => {
                const onAbort = () => {
                    reject(new DOMException('Aborted', 'AbortError'))
                }
                signal.addEventListener('abort', onAbort, { once: true })

                inFlightPromise!
                    .then((res) => {
                        signal.removeEventListener('abort', onAbort)
                        resolve(res)
                    })
                    .catch((err) => {
                        signal.removeEventListener('abort', onAbort)
                        reject(err)
                    })
            })
        }

        return inFlightPromise
    }
}
