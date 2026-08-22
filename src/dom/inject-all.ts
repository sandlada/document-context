import type {
    ISession,
    ServiceRegistry,
    ServiceToken
} from '../core/types'
import { ContextRequestEvent } from './events'
import { resolveServiceInstance } from './inject'

export interface IInjectAllOptions {
    readonly direction?: 'bottomUp' | 'topDown' | undefined
}

export interface IInjectAllAsyncOptions extends IInjectAllOptions {
    readonly signal?: AbortSignal | undefined
}

/**
 * Curried synchronous multi-provider accumulation injection verb.
 *
 * @param token Service identifier.
 * @param options Direction ordering ('bottomUp' | 'topDown').
 * @returns Curried function accepting an ISession or HTMLElement, returning an array of resolved services.
 */
export function injectAll<K extends keyof ServiceRegistry>(
    token: K,
    options?: IInjectAllOptions
): (target: ISession<any, any> | HTMLElement) => ReadonlyArray<ServiceRegistry[K]>
export function injectAll<T = unknown>(
    token: string | ServiceToken<T>,
    options?: IInjectAllOptions
): (target: ISession<any, any> | HTMLElement) => ReadonlyArray<T>
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
 * Curried asynchronous multi-provider accumulation injection verb.
 *
 * @param token Service identifier.
 * @param options Direction ordering ('bottomUp' | 'topDown') and AbortSignal.
 * @returns Curried function returning a Promise of an array of resolved services.
 */
export function injectAllAsync<K extends keyof ServiceRegistry>(
    token: K,
    options?: IInjectAllAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<ReadonlyArray<Awaited<ServiceRegistry[K]>>>
export function injectAllAsync<T = unknown>(
    token: string | ServiceToken<T>,
    options?: IInjectAllAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<ReadonlyArray<T>>
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
