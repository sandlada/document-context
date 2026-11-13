/**
 * Disconnect handling.
 *
 * A disconnect is never taken at face value: the runtime waits one microtask and checks again, so
 * that moving a node inside the document does not destroy its session.
 */

import { DocumentContextError } from '../../domain/model/errors'
import type { ApplicationRuntime } from '../context'
import type { SessionRuntime } from '../session'
import { schedulePendingRetry } from '../pending'
import { scheduleRecheck } from '../scheduling'
import { suspendSession } from './resume'

/**
 * Watch the connectivity of the host of a session.
 *
 * @param runtime - The application runtime.
 * @param session - The session to watch.
 * @returns A function that stops watching.
 */
export function watchConnectivity(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
): () => void {
    const { connectivity } = runtime.ports.host
    return connectivity.subscribe(session.adapterHost, (connected, adoptedDoc) => {
        if (adoptedDoc !== undefined) {
            void session.runAdoptHooks()
        }
        if (connected) {
            return
        }
        const watched = session.adapterHost
        scheduleRecheck(runtime, watched, () => {
            // The session may already have moved to another host. The old host staying
            // disconnected must not suspend that new mount.
            if (session.adapterHost !== watched) {
                return
            }
            handleConfirmedDisconnect(runtime, session)
        })
    })
}

/**
 * React to a confirmed disconnect.
 *
 * Anonymous sessions are disposed, keyed sessions are suspended.
 *
 * @param runtime - The application runtime.
 * @param session - The session that lost its host.
 */
export function handleConfirmedDisconnect(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
): void {
    if (session.isDisposed || session.status === 'disposed') {
        return
    }
    if (session.status === 'suspended') {
        return
    }
    if (session.token !== null) {
        if (session.status === 'starting') {
            // Confirmed disconnect ends initialization now. Waiting for an in-flight eager factory
            // would leave `ready` and the suspension TTL stuck.
            session.markDisconnected()
            suspendSession(runtime, session)
            if (!session.isDisposed) {
                session.markReady()
            }
            schedulePendingRetry(runtime)
            return
        }
        suspendSession(runtime, session)
        return
    }
    session.dispose('disconnect')
}

/**
 * The error used when a session loses its host before it finished initializing.
 *
 * @returns The error.
 */
export function unconnectedHostError(): DocumentContextError {
    return new DocumentContextError(
        'UNCONNECTED_HOST',
        'The host was disconnected while the session was initializing.',
    )
}
