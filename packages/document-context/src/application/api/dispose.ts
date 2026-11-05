/**
 * `dispose` — destroy a session.
 *
 * `dispose` is synchronous: it aborts the abort boundary, runs the cleanups and the dispose hooks
 * and completes `state$` and `lifecycle$`. Asynchronous cleanup is awaited by
 * `session[Symbol.asyncDispose]()`.
 */

import type { Session } from '../../domain/model/session'
import type { ApplicationRuntime } from '../context'
import { assertOwnedSession } from '../application/isolation'

/**
 * Dispose a session.
 *
 * @param runtime - The application runtime.
 * @param session - The session to dispose.
 */
export function disposeSession(runtime: ApplicationRuntime, session: Session<any, any>): void {
    const owned = assertOwnedSession(runtime, session)
    owned.dispose('explicit')
}
