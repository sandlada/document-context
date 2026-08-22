import { select } from '../core/select'
import { subscribe } from '../core/subscribe'
import type { ISession } from '../core/types'

export interface ISignal<T> {
    get(): T
}

/**
 * Adapts a reactive state selector from an ISession into a TC39 Signal-compatible object.
 *
 * @param session Active ISession.
 * @param selector Pure selector function.
 * @returns An ISignal object with a get() method.
 */
export function toSignal<S extends Record<PropertyKey, any>, R>(
    session: ISession<S, any>,
    selector: (state: S) => R
): ISignal<R> {
    let currentValue: R = select(selector)(session)

    subscribe((state: S) => {
        currentValue = selector(state)
    })(session)

    return {
        get(): R {
            return currentValue
        }
    }
}
