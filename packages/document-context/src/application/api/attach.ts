/**
 * `attach` host binding: pure-function lifecycle forwarding hooks.
 *
 * This module performs no DOM access, starts no timers, and installs no
 * observers: it only tracks a per-session connection flag plus the adopting
 * owner, invokes the configured callbacks on real flips, and pushes a
 * `settled$` rescan trigger so the late-binding layer re-evaluates. Host
 * adoption itself stays infra-owned (observer rebinding, registry migration);
 * `adopt` only records the owner. It runs in a plain Node environment.
 */

import type { Session } from '../../domain/index.js'
import type { ApplicationContext } from '../context.js'

/**
 * Optional lifecycle callbacks forwarded by the host. Every field is
 * optional; without callbacks `attach` still flips its flag and triggers
 * rescans.
 */
export interface AttachConfig {
    /** Runs on the first `connect` after a disconnected flag. */
    readonly onConnect?: () => void
    /** Runs on the first `disconnect` after a connected flag. */
    readonly onDisconnect?: () => void
    /**
     * Runs when the host is adopted by a new owner.
     *
     * @param owner Adopting document or owner marker.
     */
    readonly onAdopt?: (owner: unknown) => void
}

/**
 * Host hooks returned by `attach`: the host forwards its
 * `connectedCallback`, `disconnectedCallback`, and `adoptedCallback` through
 * these. Every hook is idempotent: a repeated `connect` (or `disconnect`,
 * or same-owner `adopt`) after convergence is a no-op, so the centralized
 * observer channel and manual forwarding converge without double effects.
 */
export interface HostHooks {
    /** Forwards host connection; no-op when the flag is already connected. */
    readonly connect: () => void
    /** Forwards host disconnection; no-op when already disconnected. */
    readonly disconnect: () => void
    /**
     * Forwards host adoption; records the owner for infra-owned rebinding.
     *
     * @param owner Adopting document or owner marker.
     */
    readonly adopt: (owner: unknown) => void
}

interface AttachSlot {
    connected: boolean
    owner: unknown
}

/**
 * Binds the context into the data-last `attach` verb: `attach` takes an
 * optional config, then a session, and returns the host hooks the host
 * forwards its lifecycle callbacks through. Connection state starts from
 * `session.host.isConnected`; each real flip runs the matching callback and
 * pushes one `settled$` rescan trigger. Adoption records the owner and runs
 * `onAdopt` without touching `settled$` or the DOM.
 *
 * @param ctx Application context owning the `settled$` rescan channel.
 * @returns Data-last verb mapping config to a session-to-hooks mapper.
 * @example
 * ```ts
 * import { createAttach } from './attach.js'
 *
 * const attach = createAttach(ctx)
 * const hooks = attach({ onConnect: () => console.log('up') })(session)
 * ```
 */
export function createAttach(ctx: ApplicationContext): (config?: AttachConfig) => (session: Session) => HostHooks {
    const slots = new WeakMap<object, AttachSlot>()
    const slotFor = (session: Session): AttachSlot => {
        const key = session as unknown as object
        const existing = slots.get(key)
        if (existing !== undefined) {
            return existing
        }
        const created: AttachSlot = { connected: session.host.isConnected, owner: undefined }
        slots.set(key, created)
        return created
    }
    return (config?: AttachConfig): ((session: Session) => HostHooks) => {
        const onConnect = config?.onConnect
        const onDisconnect = config?.onDisconnect
        const onAdopt = config?.onAdopt
        return (session: Session): HostHooks => {
            const slot = slotFor(session)
            return {
                connect: (): void => {
                    if (slot.connected) {
                        return
                    }
                    slot.connected = true
                    onConnect?.()
                    ctx.settled$.next()
                },
                disconnect: (): void => {
                    if (!slot.connected) {
                        return
                    }
                    slot.connected = false
                    onDisconnect?.()
                    ctx.settled$.next()
                },
                adopt: (owner: unknown): void => {
                    if (Object.is(slot.owner, owner) && slot.owner !== undefined) {
                        return
                    }
                    slot.owner = owner
                    onAdopt?.(owner)
                },
            }
        }
    }
}
