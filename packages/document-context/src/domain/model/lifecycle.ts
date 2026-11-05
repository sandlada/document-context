/**
 * Session status and lifecycle event vocabulary.
 */

/** The four states a session can be in. */
export type SessionStatus = 'starting' | 'active' | 'suspended' | 'disposed'

/** Why a session reached `disposed`. */
export type DisposalReason = 'explicit' | 'disconnect' | 'ttl' | 'cap' | 'conflict'

/** Lifecycle event names carried by `session.lifecycle$`. */
export type LifecycleEventType = 'active' | 'suspended' | 'resumed' | 'adopted' | 'disposed'

/**
 * A lifecycle event.
 *
 * `disposed` is the only event that carries a {@link DisposalReason}.
 */
export type LifecycleEvent =
    | { readonly type: 'active' }
    | { readonly type: 'suspended' }
    | { readonly type: 'resumed' }
    | { readonly type: 'adopted' }
    | { readonly type: 'disposed'; readonly reason: DisposalReason }

/** The lifecycle event that represents a given status, or `null` for `starting`. */
export function lifecycleEventForStatus(status: SessionStatus): LifecycleEvent | null {
    switch (status) {
        case 'starting':
            return null
        case 'active':
            return { type: 'active' }
        case 'suspended':
            return { type: 'suspended' }
        case 'disposed':
            return { type: 'disposed', reason: 'explicit' }
    }
}
