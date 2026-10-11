/**
 * Pure state-update orchestration: shallow-merge application plus the poisoned
 * store guard.
 *
 * This module is pure: no DOM access, no timers, no I/O. It runs in a plain
 * Node environment. `applyUpdate` never mutates its input; `updateSession`
 * reports `false` once the store is poisoned instead of throwing, so dangling
 * async closures after dispose stay silent (domain invariant 02 #4).
 *
 * Deferred to the application layer: pushing to `state$` subscribers beyond
 * the store primitive, batching storage write-backs, and cross-tab conflict
 * resolution. Those flows call `updateSession` and observe its boolean.
 */

import type { SessionState } from '../model/session.js'

/**
 * Updater accepted by {@link applyUpdate} and {@link updateSession}: either a
 * partial state merged by object spread, or a function mapping the previous
 * snapshot to new or partial state.
 */
export type StateUpdater<S extends Record<PropertyKey, unknown>> =
    | Partial<S>
    | ((prev: S) => S | Partial<S>)

/**
 * Shallow-merges an updater over the previous snapshot with object-spread
 * (`CreateDataProperty`) semantics: no deep merge, no key deletion, and no
 * prototype pollution. `__proto__` keys become own data properties instead of
 * mutating the prototype chain.
 *
 * The input snapshot is never mutated; a fresh object is always returned, even
 * for empty partials.
 *
 * @param prev Previous snapshot; treated as read-only.
 * @param updater Partial state or function returning new or partial state.
 * @returns The merged next snapshot.
 * @example
 * ```ts
 * import { applyUpdate } from './update.js'
 *
 * const next = applyUpdate({ count: 0 }, { count: 1 })
 * console.log(next)
 * ```
 */
export function applyUpdate<S extends Record<PropertyKey, unknown>>(
    prev: S,
    updater: StateUpdater<S>,
): S {
    const resolved: S | Partial<S> = typeof updater === 'function' ? updater(prev) : updater
    const base: S = { ...prev }
    const keys = Object.keys(resolved)
    for (const key of keys) {
        const value = (resolved as Record<PropertyKey, unknown>)[key as keyof S]
        Object.defineProperty(base, key, {
            value,
            enumerable: true,
            writable: true,
            configurable: true,
        })
    }
    return base
}

/**
 * Applies an updater to a session store: returns `false` immediately when the
 * store is poisoned (disposed sessions silently no-op), otherwise merges via
 * {@link applyUpdate}, replaces the snapshot with `setState`, and returns
 * `true`.
 *
 * The updater function is never invoked on a poisoned store.
 *
 * @param state Store primitive created by `createSessionState`.
 * @param updater Partial state or function returning new or partial state.
 * @returns True when the merge was applied; false when the store is poisoned.
 * @example
 * ```ts
 * import { createSessionState } from '../model/session.js'
 * import { updateSession } from './update.js'
 *
 * const store = createSessionState({ count: 0 })
 * updateSession(store, { count: 1 })
 * ```
 */
export function updateSession<S extends Record<PropertyKey, unknown>>(
    state: SessionState<S>,
    updater: StateUpdater<S>,
): boolean {
    if (state.isPoisoned()) {
        return false
    }
    if (typeof updater === 'function') {
        const resolved = (updater as (prev: S) => S | Partial<S>)(state.getSnapshot())
        state.setState(applyUpdate(state.getSnapshot(), resolved))
        return true
    }
    state.setState(applyUpdate(state.getSnapshot(), updater))
    return true
}
