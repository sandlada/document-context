/**
 * `subscribe$` — observe the state of a session.
 *
 * The subscription ends when the session is disposed; there is no need to wrap the stream in
 * `takeUntil`.
 */

import type { Subscription } from 'rxjs'
import type { Session } from '../../domain/model/session'
import type { ApplicationRuntime } from '../context'
import { assertOwnedSession } from '../application/isolation'

/**
 * Subscribe to the state of a session.
 *
 * @param runtime - The application runtime.
 * @param session - The session to observe.
 * @param listener - The listener. Receives every snapshot.
 * @returns The subscription.
 */
export function subscribeState<S>(
    runtime: ApplicationRuntime,
    session: Session<S, any>,
    listener: (state: S) => void,
): Subscription {
    const owned = assertOwnedSession(runtime, session)
    return owned.state$.subscribe(listener)
}
