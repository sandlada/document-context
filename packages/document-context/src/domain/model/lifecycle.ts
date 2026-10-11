/**
 * Session state machine: the pure `Blueprint` to `Disposed` transition
 * function and the terminal-state predicate.
 *
 * This module is pure: no DOM access, no timers, no I/O. It runs in a plain
 * Node environment. It encodes exactly the session machine edges: anonymous
 * sessions skip `Suspended` and dispose directly on disconnect, while keyed
 * sessions park in `Suspended` where resuscitation can return them to
 * `Mounted`.
 */

/**
 * Session lifecycle states: `blueprint` (declared, never mounted),
 * `initializing` (mount accepted, hydration and listeners pending), `mounted`
 * (live), `suspended` (keyed sessions parked after disconnect), and `disposed`
 * (terminal).
 */
export type SessionStatus = 'blueprint' | 'initializing' | 'mounted' | 'suspended' | 'disposed'

/**
 * Session identity kind: `anonymous` (`token: null`, no cross-host
 * resuscitation, disconnect disposes) or `keyed` (named identity that parks
 * in `Suspended` on disconnect and may resuscitate on a new host).
 */
export type SessionKind = 'anonymous' | 'keyed'

/**
 * Transition verbs accepted by `transition`: `mount` starts initialization,
 * `ready` completes it, `wait-disconnect` ends an initialization whose host
 * disconnected, `abort` cancels it, `disconnect` drops a mounted host,
 * `dispose` tears down, `resuscitate` returns a suspended session to mounted,
 * and `ttl` expires a suspended session.
 */
export type SessionTransitionEvent =
    | 'mount'
    | 'ready'
    | 'wait-disconnect'
    | 'abort'
    | 'disconnect'
    | 'dispose'
    | 'resuscitate'
    | 'ttl'

/**
 * Applies one session-machine edge. Pure function of `(status, event, kind)`:
 * no side effects, no retained state, idempotent per edge.
 *
 * @param status The current session status.
 * @param event The transition verb to apply.
 * @param kind The session identity kind, deciding suspend-versus-dispose splits.
 * @returns The next session status.
 * @throws Plain `Error` (no invented taxonomy code) naming the illegal `status + event` pair.
 * @example
 * ```ts
 * import { transition } from './lifecycle.js'
 *
 * transition('blueprint', 'mount', 'keyed')
 * transition('mounted', 'disconnect', 'keyed')
 * ```
 */
export function transition(status: SessionStatus, event: SessionTransitionEvent, kind: SessionKind): SessionStatus {
    switch (status) {
        case 'blueprint':
            if (event === 'mount') {
                return 'initializing'
            }
            break
        case 'initializing':
            if (event === 'ready') {
                return 'mounted'
            }
            if (event === 'wait-disconnect') {
                return kind === 'keyed' ? 'suspended' : 'disposed'
            }
            if (event === 'abort') {
                return 'disposed'
            }
            break
        case 'mounted':
            if (event === 'disconnect') {
                return kind === 'keyed' ? 'suspended' : 'disposed'
            }
            if (event === 'dispose') {
                return 'disposed'
            }
            break
        case 'suspended':
            if (event === 'resuscitate') {
                return 'mounted'
            }
            if (event === 'ttl' || event === 'dispose') {
                return 'disposed'
            }
            break
        case 'disposed':
            break
    }
    throw new Error(`[document-context] Illegal session transition: '${status}' cannot handle '${event}' (${kind})`)
}

/**
 * Reports whether a session status is terminal, meaning no further edge
 * applies and every event throws.
 *
 * @param status The status to inspect.
 * @returns True only for `disposed`.
 * @example
 * ```ts
 * import { isTerminal } from './lifecycle.js'
 *
 * console.log(isTerminal('disposed'))
 * ```
 */
export function isTerminal(status: SessionStatus): boolean {
    return status === 'disposed'
}
