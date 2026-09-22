import { select } from '../core/select'
import { subscribe } from '../core/subscribe'
import type { ISession } from '../core/types'

/**
 * Minimal TC39 Signal-compatible view over a session selector.
 *
 * Exposes only `get(): T`; the object is not itself reactive. Framework
 * signal integrations poll or wrap `get()` in their own tracking scope.
 *
 * @property get - Returns the latest selector value. See {@link toSignal}.
 */
export interface ISignal<T> {
    get(): T
}

/**
 * Adapts `select(selector)(session)` into a pull-based signal object.
 *
 * Captures the current selector value immediately, then keeps it fresh via an
 * internal `subscribe()` feed that re-runs `selector` on every state change.
 * The subscription is intentionally retained for the session lifetime (no
 * unsubscribe is returned), so prefer one signal per long-lived view rather
 * than per render. Selectors must stay pure; disposed sessions freeze the
 * last value instead of updating.
 *
 * @param session - Live session to observe.
 * @param selector - Pure projection `(state) => value`.
 * @returns An `ISignal<R>` whose `get()` returns the latest value.
 *
 * @example
 * ```ts
 * import { toSignal } from '@sandlada/document-context'
 *
 * const countSignal = toSignal(session, (s: { count: number }) => s.count)
 * console.log(countSignal.get())
 * ```
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
