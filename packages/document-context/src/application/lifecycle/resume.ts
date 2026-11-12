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
import { settleHooks } from './hooks'

/**
 * Keep a keyed session in the suspension table and arm its TTL.
 *
 * @param runtime - The application runtime.
 * @param session - The suspended session.
 */
function armSuspensionTimer(runtime: ApplicationRuntime, session: SessionRuntime<any>): void {
    const token = session.token
    if (token !== null && !runtime.keyed.has(token)) {
        runtime.keyed.set(token, session)
        runtime.suspendedOrder.push(token)
    }
    if (token === null || session.pinned) {
        enforceSuspensionCap(runtime)
        return
    }
    const cancel = runtime.ports.host.scheduler.timeout(() => {
        session.dispose('ttl')
        runtime.notifySessionsChanged()
    }, session.suspensionTtlMs)
    session.setSuspensionTimer(cancel)
    enforceSuspensionCap(runtime)
}

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
    if (session.token !== null && session.suspensionTtlMs === 0 && !session.pinned) {
        session.dispose('disconnect')
        return
    }
    if (suspending.has(session)) {
        return
    }
    const token = session.token
    session.detachContextRequest()
    runtime.ports.host.scope.undeclare(session.adapterHost)
    const finish = (): void => {
        suspending.delete(session)
        if (session.isDisposed || session.status === 'suspended' || session.status === 'disposed') {
            return
        }
        session.markSuspended()
        if (token !== null) {
            runtime.keyed.set(token, session)
            runtime.suspendedOrder.push(token)
        }
        armSuspensionTimer(runtime, session)
        runtime.notifySessionsChanged()
    }
    if (session.status !== 'active') {
        finish()
        return
    }
    const pending = settleHooks(session, 'suspend')
    if (pending === undefined) {
        finish()
        return
    }
    suspending.add(session)
    void pending.then(finish, finish)
}

/** Sessions whose `onSuspend` promises have not settled yet. */
const suspending = new WeakSet<SessionRuntime<any>>()

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
    const previous = session.adapterHost
    if (token !== null) {
        runtime.ports.host.tokens.remove(previous, token)
    }
    runtime.unregisterSession(session)
    session.rebind(host)
    runtime.registerSession(session)
    if (token !== null) {
        runtime.ports.host.tokens.write(host, token)
        runtime.keyed.delete(token)
        const index = runtime.suspendedOrder.indexOf(token)
        if (index >= 0) {
            runtime.suspendedOrder.splice(index, 1)
        }
    }
    session.setSuspensionTimer(() => undefined)
    session.setConnectivityWatcher(watchConnectivity(runtime, session))
    let pending: Promise<void> | undefined
    try {
        pending = session.runMountHooksSync()
    } catch (error) {
        session.fail(error)
        session.dispose('explicit')
        return
    }
    const finish = (): void => {
        if (session.isDisposed) {
            return
        }
        if (!runtime.ports.host.connectivity.isConnected(session.adapterHost)) {
            armSuspensionTimer(runtime, session)
            return
        }
        const resumePending = settleHooks(session, 'resume')
        const activate = (): void => {
            if (session.isDisposed) {
                return
            }
            if (!runtime.ports.host.connectivity.isConnected(session.adapterHost)) {
                armSuspensionTimer(runtime, session)
                return
            }
            session.activate(true)
        }
        if (resumePending === undefined) {
            activate()
            return
        }
        void resumePending.then(activate, activate)
    }
    if (pending === undefined) {
        finish()
        return
    }
    void pending.then(finish, (error: unknown) => {
        session.fail(error)
        session.dispose('explicit')
    })
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
