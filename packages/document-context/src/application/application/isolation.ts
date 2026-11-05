/**
 * Application isolation.
 *
 * Every session belongs to exactly one application. Operating on a session through a different
 * application is **rejected** — never silently ignored, because a silent no-op would hide
 * cross-application bugs.
 */

import { DocumentContextError } from '../../domain/model/errors'
import type { Session } from '../../domain/model/session'
import type { ApplicationRuntime } from '../context'
import type { SessionRuntime } from '../session'

/**
 * Whether a session belongs to an application.
 *
 * @param runtime - The application runtime.
 * @param session - The session to test.
 * @returns `true` when the session was mounted by this application.
 */
export function isOwnedSession(
    runtime: ApplicationRuntime,
    session: Session<any, any>,
): boolean {
    const candidate = session as unknown as SessionRuntime<any>
    return candidate !== null && typeof candidate === 'object' && candidate.owner === runtime
}

/**
 * Assert that a session belongs to an application.
 *
 * @param runtime - The application runtime.
 * @param session - The session to check.
 * @throws A `DocumentContextError` with code `FOREIGN_SESSION` when the session belongs to another
 * application.
 */
export function assertOwnedSession(
    runtime: ApplicationRuntime,
    session: Session<any, any>,
): SessionRuntime<any> {
    if (!isOwnedSession(runtime, session)) {
        throw new DocumentContextError(
            'FOREIGN_SESSION',
            'The session belongs to a different application.',
        )
    }
    return session as unknown as SessionRuntime<any>
}
