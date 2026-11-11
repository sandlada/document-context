/**
 * `sessionAt` / `session$` — track the nearest session of an element.
 *
 * Only `active` sessions whose host is still connected are visible. A resumed session is delivered
 * as the very same object, so `===` comparisons stay valid.
 */

import { Observable } from 'rxjs'
import type { Session } from '../../domain/model/session'
import type { ApplicationRuntime } from '../context'
import { chainFrom } from '../resolver'

/**
 * The nearest session of an element.
 *
 * @param runtime - The application runtime.
 * @param target - The element.
 * @returns The session, or `null` when no active session covers the element.
 */
export function sessionAt(
    runtime: ApplicationRuntime,
    target: unknown,
): Session<any, any> | null {
    const host = runtime.ports.host.scope.hostOf(target)
    if (host === null) {
        return null
    }
    for (const candidate of chainFrom(host)) {
        const session = runtime.sessions.get(candidate)
        if (session === undefined || session.status !== 'active') {
            continue
        }
        if (!runtime.ports.host.connectivity.isConnected(candidate)) {
            continue
        }
        return session
    }
    return null
}

/**
 * Track the nearest session of an element.
 *
 * @param runtime - The application runtime.
 * @param target - The element.
 * @returns The observable.
 */
export function sessionStream(
    runtime: ApplicationRuntime,
    target: unknown,
): Observable<Session<any, any> | null> {
    return new Observable<Session<any, any> | null>((subscriber) => {
        let current: Session<any, any> | null = null
        let first = true
        let watching = false
        const stops: (() => void)[] = []
        const watchChain = (): void => {
            for (const stop of stops.splice(0)) {
                stop()
            }
            const host = runtime.ports.host.scope.hostOf(target)
            if (host === null) {
                return
            }
            for (const candidate of chainFrom(host)) {
                stops.push(
                    runtime.ports.host.connectivity.subscribe(candidate, () => {
                        emit()
                    }),
                )
                stops.push(
                    runtime.ports.host.connectivity.subscribeStructure(candidate, () => {
                        emit()
                    }),
                )
            }
        }
        const emit = (): void => {
            const next = sessionAt(runtime, target)
            if (first || next !== current) {
                first = false
                current = next
                subscriber.next(next)
            }
            if (!watching) {
                watching = true
                try {
                    watchChain()
                } finally {
                    watching = false
                }
            }
        }
        const stopSessions = runtime.onSessionsChanged(emit)
        emit()
        return () => {
            stopSessions()
            for (const stop of stops) {
                stop()
            }
        }
    })
}
