/**
 * `read` — read the current state snapshot synchronously.
 *
 * `read` never takes part in lazy loading and never returns a promise. On a disposed session it
 * returns the last snapshot.
 */

import type { Session } from '../../domain/model/session'
import type { ApplicationRuntime } from '../context'
import { assertOwnedSession } from '../application/isolation'

/**
 * Read the current state snapshot of a session.
 *
 * @param runtime - The application runtime.
 * @param session - The session to read.
 * @param selector - The projection applied to the snapshot.
 * @returns The projected value.
 */
export function readState<S = any, R = any>(
    runtime: ApplicationRuntime,
    session: Session<S, any>,
    selector: (state: S) => R,
): R {
    const owned = assertOwnedSession(runtime, session)
    return selector(owned.snapshot())
}
