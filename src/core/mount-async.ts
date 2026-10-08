import { mount } from './mount'
import type { IContextBlueprint, IMountOptions, ISession } from './types'

/**
 * Asynchronous mount boundary: mounts synchronously, then yields one microtask
 * before resolving.
 *
 * This is intentionally thin: it delegates to `mount(blueprint, options)(
 * element)` and awaits `Promise.resolve()`, giving pending mount-hook
 * microtasks and async storage hydration callbacks a chance to run. It does
 * not itself await async providers to completion; resolve those explicitly
 * with `injectAsync()`. Idempotency, keyed auto-resuscitation, and conflict
 * policy match `mount` exactly.
 *
 * @param blueprint - Immutable blueprint definition.
 * @param options - Optional keyed identity, suspension TTL, and conflict
 * policy; see {@link IMountOptions}.
 * @returns A curried function accepting the host `HTMLElement` and resolving
 * to the mounted `ISession`.
 *
 * @example
 * ```ts
 * import { mountAsync, injectAsync } from '@sandlada/document-context'
 *
 * const session = await mountAsync(blueprint)(document.getElementById('app')!)
 * const config = await injectAsync('remote-config')(session)
 * ```
 */
export function mountAsync<S extends Record<PropertyKey, any>, Services>(
    blueprint: IContextBlueprint<S, Services>,
    options?: IMountOptions
): (element: HTMLElement) => Promise<ISession<S, Services>> {
    return async (element: HTMLElement): Promise<ISession<S, Services>> => {
        const session = mount(blueprint, options)(element)
        await Promise.resolve()
        return session
    }
}
