/**
 * `update` — replace the state of a session.
 *
 * The updater is synchronous and its return value replaces the whole snapshot: keys that are not
 * written back are removed.
 */

import type { Session } from '../../domain/model/session'
import type { ApplicationRuntime } from '../context'
import { assertOwnedSession } from '../application/isolation'

/**
 * Replace the state of a session.
 *
 * @param runtime - The application runtime.
 * @param session - The session to update.
 * @param updater - The updater. Must be synchronous.
 * @returns `false` when the session was disposed, `true` otherwise.
 */
export function updateState<S = any>(
    runtime: ApplicationRuntime,
    session: Session<S, any>,
    updater: (state: S) => S,
): boolean {
    const owned = assertOwnedSession(runtime, session)
    return owned.update(updater)
}
