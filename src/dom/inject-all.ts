import type {
    ISession,
    ServiceRegistry,
    ServiceToken
} from '../core/types'
import { ContextRequestEvent } from './events'
import { resolveServiceInstance } from './inject'

/**
 * Ordering options for {@link injectAll} / {@link injectAllAsync}.
 *
 * @property direction - `'bottomUp'` (default) collects nearest-first as the
 * `context-request` event bubbles; `'topDown'` reverses the array so the
 * farthest ancestor comes first.
 */
export interface IInjectAllOptions {
    readonly direction?: 'bottomUp' | 'topDown' | undefined
}

/**
 * Ordering plus cancellation options for {@link injectAllAsync}.
 *
 * @property direction - See {@link IInjectAllOptions}.
 * @property signal - Currently accepted for API symmetry; collection itself is
 * synchronous event dispatch followed by `Promise.all`, so abort only affects
 * awaiting callers that wire it manually.
 */
export interface IInjectAllAsyncOptions extends IInjectAllOptions {
    readonly signal?: AbortSignal | undefined
}

/**
 * Curried sync multi-provider accumulation over the `ServiceRegistry` map.
 *
 * Typed overload: collects `ReadonlyArray<ServiceRegistry[K]>` from the local
 * session plus every bubbling ancestor responder.
 *
 * @param token - Augmented registry key.
 * @param options - Optional `{ direction }` ordering.
 * @returns Curried collector `(elementOrSession) => ReadonlyArray<...>`.
 *
 * @example
 * ```ts
 * const loggers = injectAll('logger')(childEl)
 * ```
 */
export function injectAll<K extends keyof ServiceRegistry>(
    token: K,
    options?: IInjectAllOptions
): (target: ISession<any, any> | HTMLElement) => ReadonlyArray<ServiceRegistry[K]>
/**
 * Curried sync multi-provider accumulation over a string or branded token.
 *
 * Generic overload for untyped keys and `ServiceToken<T>` values.
 *
 * @param token - String key or branded token.
 * @param options - Optional `{ direction }` ordering.
 * @returns Curried collector `(elementOrSession) => ReadonlyArray<T>`.
 *
 * @example
 * ```ts
 * const middlewares = injectAll('middleware', { direction: 'topDown' })(session)
 * ```
 */
export function injectAll<T = unknown>(
    token: string | ServiceToken<T>,
    options?: IInjectAllOptions
): (target: ISession<any, any> | HTMLElement) => ReadonlyArray<T>
/**
 * Curried synchronous multi-provider accumulation verb.
 *
 * Unlike `inject()` (first match wins via `stopPropagation()`), this
 * dispatches with `multi: true` so every ancestor responder appends its
 * instance: the local session registration first, then each bubbling host in
 * turn. Each provider resolves with its own lifecycle semantics via
 * `resolveServiceInstance()`. Returns a frozen-order plain array (empty when
 * nothing provides the token; never throws `UnknownServiceError`).
 *
 * @param token - Service identifier.
 * @param options - Optional `{ direction }`; `'topDown'` reverses the
 * nearest-first collection order.
 * @returns Curried function accepting an `ISession` or `HTMLElement` and
 * returning a readonly array of resolved services.
 *
 * @example
 * ```ts
 * import { injectAll } from '@sandlada/document-context'
 *
 * const useMiddlewares = injectAll('middleware', { direction: 'topDown' })
 * const chain = useMiddlewares(document.getElementById('leaf')!)
 * ```
 */
export function injectAll(
    token: any,
    options?: IInjectAllOptions
): (target: ISession<any, any> | HTMLElement) => ReadonlyArray<any> {
    return (target: ISession<any, any> | HTMLElement): ReadonlyArray<any> => {
        const results: any[] = []

        let element: HTMLElement
        if ('blueprint' in target && 'target' in target) {
            const session = target as ISession<any, any>
            const localReg = session.blueprint.providers.get(token)
            if (localReg) {
                results.push(resolveServiceInstance(localReg, session))
            }
            element = session.target
        } else {
            element = target as HTMLElement
        }

        const event = new ContextRequestEvent(
            token,
            (value) => {
                results.push(value)
            },
            { multi: true }
        )

        element.dispatchEvent(event)

        if (options?.direction === 'topDown') {
            return [...results].reverse()
        }

        return results
    }
}

/**
 * Curried async multi-provider accumulation over the `ServiceRegistry` map.
 *
 * Typed overload: resolves to
 * `Promise<ReadonlyArray<Awaited<ServiceRegistry[K]>>>`.
 *
 * @param token - Augmented registry key.
 * @param options - Optional `{ direction, signal }`.
 * @returns Curried collector returning a promise of the array.
 *
 * @example
 * ```ts
 * const configs = await injectAllAsync('remote-config')(childEl)
 * ```
 */
export function injectAllAsync<K extends keyof ServiceRegistry>(
    token: K,
    options?: IInjectAllAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<ReadonlyArray<Awaited<ServiceRegistry[K]>>>
/**
 * Curried async multi-provider accumulation over a string or branded token.
 *
 * Generic overload for untyped keys and `ServiceToken<T>` values.
 *
 * @param token - String key or branded token.
 * @param options - Optional `{ direction, signal }`.
 * @returns Curried collector returning a promise of the array.
 *
 * @example
 * ```ts
 * const svcs = await injectAllAsync('plugin', { direction: 'topDown' })(session)
 * ```
 */
export function injectAllAsync<T = unknown>(
    token: string | ServiceToken<T>,
    options?: IInjectAllAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<ReadonlyArray<T>>
/**
 * Curried asynchronous multi-provider accumulation verb.
 *
 * Same bubbling `multi: true` collection as `injectAll()`, except each
 * collected value may be a promise (async factories are invoked, not awaited
 * at collection time) and the result is `Promise.all()`-resolved before
 * returning. A single rejection rejects the whole array. Ordering follows
 * `options.direction` (`'bottomUp'` default, `'topDown'` reversed).
 *
 * @param token - Service identifier.
 * @param options - Optional `{ direction, signal }`.
 * @returns Curried function accepting an `ISession` or `HTMLElement` and
 * resolving to a readonly array of awaited services.
 *
 * @example
 * ```ts
 * import { injectAllAsync } from '@sandlada/document-context'
 *
 * const plugins = await injectAllAsync('plugin')(document.getElementById('leaf')!)
 * ```
 */
export function injectAllAsync(
    token: any,
    options?: IInjectAllAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<ReadonlyArray<any>> {
    return async (target: ISession<any, any> | HTMLElement): Promise<ReadonlyArray<any>> => {
        const collected: any[] = []

        let element: HTMLElement
        if ('blueprint' in target && 'target' in target) {
            const session = target as ISession<any, any>
            const localReg = session.blueprint.providers.get(token)
            if (localReg) {
                collected.push(localReg.factory(session))
            }
            element = session.target
        } else {
            element = target as HTMLElement
        }

        const event = new ContextRequestEvent(
            token,
            (value) => {
                collected.push(value)
            },
            { multi: true }
        )

        element.dispatchEvent(event)

        const resolved = await Promise.all(collected)

        if (options?.direction === 'topDown') {
            return [...resolved].reverse()
        }

        return resolved
    }
}
