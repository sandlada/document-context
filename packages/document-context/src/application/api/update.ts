/**
 * State update verb: a pure state push with shallow-merge semantics.
 * Storage write-back is owned by the mount track's subscription; update only
 * pushes into the session store and reports whether the push landed.
 *
 * Phase: runtime (application layer). The factory is pure: calling
 * `createUpdate` performs no I/O and reads no session. The verb looks the
 * record up live per call and delegates to the domain update kernel. Side
 * effects: replacing the store snapshot (immutable swap, never in-place
 * mutation). Idempotency: applying the same updater twice merges twice.
 * Lifecycle: disposed or unknown sessions silently no-op with `false`, so
 * dangling async closures after dispose stay quiet.
 */

import { updateSession } from '../../domain/index.js'
import type { MountSessionRecord, Session, SessionState, StateUpdater } from '../../domain/index.js'

/**
 * Structural application context consumed by update: the facade-to-record
 * lookup only. Mirrors the frozen `ApplicationContext` subset this track
 * needs; `../context.js` (parallel track) is intentionally not imported so
 * this module typechecks standalone.
 */
export interface UpdateContext {
    /** Session facade to live record lookup. */
    readonly records: WeakMap<object, MountSessionRecord<Record<PropertyKey, unknown>>>
}

/**
 * State update verb factory.
 *
 * Phase: runtime command (first tier). Purity: the updater runs against the
 * previous snapshot and merges with object-spread semantics (no deep merge,
 * no key deletion). Side effects: the store snapshot swap plus downstream
 * subscriber notification. Idempotency: each call applies once; disposed or
 * unknown sessions return `false` without invoking the updater. Lifecycle:
 * suspended sessions update normally; disposed sessions silently no-op.
 */
export interface UpdateFn {
    /**
     * Pushes a partial state or updater function into the session store.
     *
     * @param updater Partial state or function mapping the previous snapshot
     * to new or partial state.
     * @returns Data-last command mapping a session to whether the push
     * landed (`false` for disposed or unknown sessions).
     * @example
     * ```ts
     * import { createUpdate } from './update.js'
     *
     * const update = createUpdate(ctx)
     * const ok = update((state: { count: number }) => ({ count: state.count + 1 }))(session)
     * console.log(ok)
     * ```
     */
    <S extends Record<PropertyKey, unknown>>(updater: StateUpdater<S>): (session: Session<S, unknown>) => boolean
}

/**
 * Creates the update verb bound to one application context.
 *
 * Phase: pure factory; no DOM, no I/O, no listeners. Purity: creating the
 * verb never touches any session. Side effects: only the returned verb
 * pushes state, and only when called. Idempotency: creating twice yields
 * independent verbs over the same context. Lifecycle: records are observed
 * live per call.
 *
 * @param ctx Update context owning the facade-to-record lookup.
 * @returns The `update` verb.
 * @example
 * ```ts
 * import { createUpdate } from './update.js'
 *
 * const update = createUpdate(ctx)
 * const ok = update({ count: 1 })(session)
 * console.log(ok)
 * ```
 */
export const createUpdate = (ctx: UpdateContext): UpdateFn => {
    const update = (<S extends Record<PropertyKey, unknown>>(updater: StateUpdater<S>) =>
        (session: Session<S, unknown>): boolean => {
            const record = ctx.records.get(session)
            if (record === undefined) {
                return false
            }
            return updateSession(record.sessionState as unknown as SessionState<S>, updater)
        }) as UpdateFn
    return update
}
