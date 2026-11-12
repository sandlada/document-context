/**
 * `update` — replace the state of a session.
 *
 * The next snapshot replaces the whole state: keys that are not written back are removed. Pass a
 * function to compute that snapshot from the current one, or pass the snapshot itself.
 */

import type { Session } from '../../domain/model/session'
import type { ApplicationRuntime } from '../context'
import { assertOwnedSession } from '../application/isolation'

/** A synchronous state replacement: the next snapshot, or a function that returns it. */
export type StateUpdate<S> = S | ((state: S) => S)

/**
 * Replace the state of a session.
 *
 * @param runtime - The application runtime.
 * @param session - The session to update.
 * @param update - The next snapshot, or a synchronous function that returns it.
 * @returns `false` when the session was disposed, `true` otherwise.
 */
export function updateState<S = any>(
    runtime: ApplicationRuntime,
    session: Session<S, any>,
    update: StateUpdate<S>,
): boolean {
    const owned = assertOwnedSession(runtime, session)
    return owned.update((state) =>
        typeof update === 'function' ? (update as (state: S) => S)(state) : update,
    )
}
