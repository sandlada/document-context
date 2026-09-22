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

/**
 * Options for {@link injectAsync} / {@link injectAllAsync}.
 *
 * @property signal - Optional `AbortSignal` for per-caller cancellation. A
 * caller abort rejects only that caller's promise with an `AbortError`
 * `DOMException`; the shared in-flight provider promise is unaffected.
 */
export interface IInjectAsyncOptions {
    readonly signal?: AbortSignal | undefined
}

/**
 * Walks `element` and its `parentElement` chain for the nearest non-disposed
 * session whose blueprint registers `token`.
 *
 * Internal lookup for `injectAsync()`: unlike sync `inject()`, it does not
 * dispatch events but scans the element-session WeakMap directly, so only
 * mounted ancestors (not bare `context-request` responders) participate.
 *
 * @param element - Starting element (typically the injection target).
 * @param token - Service identifier to find.
 * @returns The nearest `{ session, registration }` pair, or `null` when no
 * ancestor registers the token.
 */
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
 * Curried async injection over the `ServiceRegistry` string-token map.
 *
 * Typed overload: `token` must be a key of the augmented `ServiceRegistry`
 * and the promise resolves to `Awaited<ServiceRegistry[K]>`.
 *
 * @param token - Augmented registry key.
 * @param options - Optional `{ signal }` for per-caller abort isolation.
 * @returns Curried resolver `(elementOrSession) => Promise<...>`.
 *
 * @example
 * ```ts
 * const config = await injectAsync('remote-config')(document.getElementById('app')!)
 * ```
 */
export function injectAsync<K extends keyof ServiceRegistry>(
    token: K,
    options?: IInjectAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<Awaited<ServiceRegistry[K]>>
/**
 * Curried async injection over a branded {@link ServiceToken}.
 *
 * Typed overload: resolves to the token's phantom type `T`, unwrapping
 * provider-level `Promise` nesting via `await` semantics.
 *
 * @param token - Branded token created by `createToken<T>()`.
 * @param options - Optional `{ signal }` for per-caller abort isolation.
 * @returns Curried resolver `(elementOrSession) => Promise<T>`.
 *
 * @example
 * ```ts
 * const svc = await injectAsync(ConfigToken)(session)
 * ```
 */
export function injectAsync<T>(
    token: ServiceToken<T>,
    options?: IInjectAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<T>
/**
 * Curried async injection over an untyped string token.
 *
 * Fallback overload; the caller supplies `T` explicitly.
 *
 * @param token - Arbitrary string key.
 * @param options - Optional `{ signal }` for per-caller abort isolation.
 * @returns Curried resolver `(elementOrSession) => Promise<T>`.
 *
 * @example
 * ```ts
 * const ctl = new AbortController()
 * const svc = await injectAsync('remote-config', { signal: ctl.signal })(session)
 * ```
 */
export function injectAsync<T = unknown>(
    token: string,
    options?: IInjectAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<T>
/**
 * Curried asynchronous injection verb with promise coalescing, self-healing
 * eviction, and multi-caller abort isolation.
 *
 * Accepts an `ISession` (local providers first) or a connected `HTMLElement`
 * (nearest mounted ancestor via `parentElement` walk, then global singletons).
 * Cached values (`'singleton'` globals, `'scoped'` session entries) return
 * immediately. Otherwise the factory runs once per token: concurrent callers
 * share the same in-flight promise, rejections evict the entry instantly so
 * the next call retries, and an already-aborted caller `signal` rejects with
 * `AbortError` without cancelling the shared attempt. Unknown tokens throw
 * `UnknownServiceError`; async cycles throw `CircularDependencyError`;
 * detached nodes throw `UnconnectedNodeError` unless globally cached.
 *
 * @param token - Service identifier (registry key, branded token, or string).
 * @param options - Optional `{ signal }` abort options.
 * @returns Curried function accepting an `ISession` or `HTMLElement` and
 * resolving to the service instance.
 * @throws {UnknownServiceError} When no provider or global entry exists.
 * @throws {UnconnectedNodeError} When the element target is detached.
 * @throws {CircularDependencyError} When async factories form a cycle.
 *
 * @example
 * ```ts
 * import { injectAsync } from '@sandlada/document-context'
 *
 * const useConfig = injectAsync('remote-config')
 * const config = await useConfig(session)
 * const [a, b] = await Promise.all([useConfig(el), useConfig(el)])
 * ```
 */
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
