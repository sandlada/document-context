import { mount } from './mount'
import type { IContextBlueprint, ISession } from './types'

/**
 * Asynchronous mount boundary that awaits storage hydration and eager async initialization.
 *
 * @param blueprint The immutable blueprint definition.
 * @returns A curried function returning a Promise resolving to the mounted ISession.
 */
export function mountAsync<S extends Record<PropertyKey, any>, Services>(
    blueprint: IContextBlueprint<S, Services>
): (element: HTMLElement) => Promise<ISession<S, Services>> {
    return async (element: HTMLElement): Promise<ISession<S, Services>> => {
        const session = mount(blueprint)(element)
        await Promise.resolve()
        return session
    }
}
