/**
 * Suspension and resuscitation.
 *
 * A keyed session that lost its host is suspended: the state, the scoped dependencies and the
 * open `state$` subscriptions survive. Within the TTL the same token may come back on another
 * connected host and resume.
 */

import type { Host } from '../../domain/model/session'
import type { ApplicationRuntime } from '../context'
import type { SessionRuntime } from '../session'
import { watchConnectivity } from './disconnect'
import { runHooksSync } from './hooks'

/**
 * Suspend a keyed session.
 *
 * @param runtime - The application runtime.
 * @param session - The session to suspend.
 */
export function suspendSession(runtime: ApplicationRuntime, session: SessionRuntime<any>): void {
    if (session.status !== 'active' && session.status !== 'starting') {
        return
    }
    const token = session.token
    session.detachContextRequest()
    runtime.ports.host.scope.undeclare(session.adapterHost)
    if (session.status === 'active') {
        runHooksSync(session, 'suspend')
    }
    session.markSuspended()
    if (token !== null) {
        runtime.keyed.set(token, session)
        runtime.suspendedOrder.push(token)
    }
    if (token !== null && !session.pinned) {
        if (session.suspensionTtlMs === 0) {
            session.dispose('ttl')
            runtime.notifySessionsChanged()
            return
        }
        const cancel = runtime.ports.host.scheduler.timeout(() => {
            session.dispose('ttl')
            runtime.notifySessionsChanged()
        }, session.suspensionTtlMs)
        session.setSuspensionTimer(cancel)
    }
    enforceSuspensionCap(runtime)
    runtime.notifySessionsChanged()
}

/**
 * Resume a suspended session on a new host.
 *
 * The `onMount` hooks that were skipped during initialization run first, then the `onResume`
 * hooks. The state is preserved.
 *
 * @param runtime - The application runtime.
 * @param session - The suspended session.
 * @param host - The new host.
 */
export function resumeSession(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
    host: Host,
): void {
    const token = session.token
    runtime.unregisterSession(session)
    session.rebind(host)
    runtime.registerSession(session)
    if (token !== null) {
        runtime.keyed.delete(token)
        const index = runtime.suspendedOrder.indexOf(token)
        if (index >= 0) {
            runtime.suspendedOrder.splice(index, 1)
        }
    }
    session.setSuspensionTimer(() => undefined)
    session.setConnectivityWatcher(watchConnectivity(runtime, session))
    try {
        session.runMountHooksSync()
    } catch (error) {
        session.fail(error)
        session.dispose('explicit')
        return
    }
    runHooksSync(session, 'resume')
    session.activate(true)
}

/**
 * The suspended session of a token, when it may still be resumed.
 *
 * @param runtime - The application runtime.
 * @param token - The keyed identity.
 * @returns The suspended session, or `undefined`.
 */
export function findSuspendedSession(
    runtime: ApplicationRuntime,
    token: string,
): SessionRuntime<any> | undefined {
    return runtime.keyed.get(token)
}

/**
 * Enforce the application level cap of suspended sessions.
 *
 * The oldest suspended session is disposed with reason `cap`. Pinned sessions are not counted.
 *
 * @param runtime - The application runtime.
 */
export function enforceSuspensionCap(runtime: ApplicationRuntime): void {
    const limit = runtime.limits.maxSuspendedSessions
    const candidates = runtime.suspendedOrder
        .map((token) => runtime.keyed.get(token))
        .filter(
            (session): session is SessionRuntime<any> =>
                session !== undefined && !session.pinned,
        )
    while (candidates.length > limit) {
        const oldest = candidates.shift()
        oldest?.dispose('cap')
    }
}
