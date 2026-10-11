/**
 * Blueprint lifecycle-hook operators: observe mount, dispose, suspend,
 * resuscitate, and adopt.
 *
 * This module is pure: no DOM access, no timers, no I/O. It runs in a plain
 * Node environment. Operators append registrations only; handlers never run
 * here (mount executes them in lifecycle order).
 */
import type { BlueprintHookEvent, ContextBlueprint, HookRegistration } from '../../domain/model/blueprint.js'
import type { HostPort } from '../../domain/ports/host.js'
import type { Session } from '../../domain/model/session.js'

/**
 * Pure blueprint transformer. The canonical definition lives in `pipe.ts`;
 * this alias is structurally identical and local so these operators stay free
 * of sibling imports.
 */
type BlueprintOperator<S extends Record<PropertyKey, unknown>> = (bp: ContextBlueprint<S>) => ContextBlueprint<S>

/**
 * Appends a hook registration, copying the hooks array and sharing every
 * other blueprint slice by reference.
 */
function appendHook<S extends Record<PropertyKey, unknown>>(
    bp: ContextBlueprint<S>,
    event: BlueprintHookEvent,
    handler: HookRegistration['handler'],
): ContextBlueprint<S> {
    return { ...bp, hooks: [...bp.hooks, { event, handler }] }
}

/**
 * Observes entry into `Mounted` (hydration plus eager services complete).
 * Phase 1 of the two-phase model: a pure, lazy, in-memory declaration with
 * zero DOM access, zero I/O, zero listeners, and zero handler execution. The
 * handler runs at mount in FIFO order and may return a cleanup closure for
 * the LIFO disposal chain; the call is idempotent and never mutates inputs.
 *
 * @param handler Hook invoked with the mounted session; its optional return
 * is kept as a disposal cleanup.
 * @returns A blueprint operator appending the registration.
 * @example
 * ```ts
 * import { createContext } from './create-context.js'
 * import { onMount } from './hooks.js'
 *
 * const blueprint = onMount(() => {
 *     console.log('mounted')
 * })(createContext({ count: 0 }))
 * console.log(blueprint.hooks.length)
 * ```
 */
export function onMount<S extends Record<PropertyKey, unknown>>(
    handler: (session: Session<S>) => void | (() => void),
): BlueprintOperator<S> {
    return (bp: ContextBlueprint<S>): ContextBlueprint<S> => appendHook(bp, 'mount', handler)
}

/**
 * Observes terminal `Disposed`. Phase 1 of the two-phase model: a pure,
 * lazy, in-memory declaration with zero DOM access, zero I/O, zero
 * listeners, and zero handler execution. The handler runs in the synchronous
 * disposal phase in LIFO order (after mount cleanup closures); async returns
 * settle fire-and-forget. The call is idempotent and never mutates inputs.
 *
 * @param handler Hook invoked with the disposed session; async work is not
 * awaited by disposal.
 * @returns A blueprint operator appending the registration.
 * @example
 * ```ts
 * import { createContext } from './create-context.js'
 * import { onDispose } from './hooks.js'
 *
 * const blueprint = onDispose(() => {
 *     console.log('disposed')
 * })(createContext({ count: 0 }))
 * console.log(blueprint.hooks.length)
 * ```
 */
export function onDispose<S extends Record<PropertyKey, unknown>>(
    handler: (session: Session<S>) => void | Promise<void>,
): BlueprintOperator<S> {
    return (bp: ContextBlueprint<S>): ContextBlueprint<S> => appendHook(bp, 'dispose', handler)
}

/**
 * Observes the keyed `Mounted` to `Suspended` transition. Phase 1 of the
 * two-phase model: a pure, lazy, in-memory declaration with zero DOM access,
 * zero I/O, zero listeners, and zero handler execution. The handler pauses
 * resources in FIFO order without running mount cleanups; the call is
 * idempotent and never mutates inputs.
 *
 * @param handler Hook invoked with the suspended session.
 * @returns A blueprint operator appending the registration.
 * @example
 * ```ts
 * import { createContext } from './create-context.js'
 * import { onSuspend } from './hooks.js'
 *
 * const blueprint = onSuspend(() => {
 *     console.log('suspended')
 * })(createContext({ count: 0 }))
 * console.log(blueprint.hooks.length)
 * ```
 */
export function onSuspend<S extends Record<PropertyKey, unknown>>(
    handler: (session: Session<S>) => void,
): BlueprintOperator<S> {
    return (bp: ContextBlueprint<S>): ContextBlueprint<S> => appendHook(bp, 'suspend', handler)
}

/**
 * Observes the `Suspended` to `Mounted` resuscitation transition. Phase 1 of
 * the two-phase model: a pure, lazy, in-memory declaration with zero DOM
 * access, zero I/O, zero listeners, and zero handler execution. The handler
 * rebinds resources to the new host in FIFO order with state fully
 * continued; the call is idempotent and never mutates inputs.
 *
 * @param handler Hook invoked with the resuscitated session and its new
 * host; native references must be re-read here.
 * @returns A blueprint operator appending the registration.
 * @example
 * ```ts
 * import { createContext } from './create-context.js'
 * import { onResuscitate } from './hooks.js'
 *
 * const blueprint = onResuscitate((_session, _host) => {
 *     console.log('resuscitated')
 * })(createContext({ count: 0 }))
 * console.log(blueprint.hooks.length)
 * ```
 */
export function onResuscitate<S extends Record<PropertyKey, unknown>>(
    handler: (session: Session<S>, host: HostPort) => void,
): BlueprintOperator<S> {
    return (bp: ContextBlueprint<S>): ContextBlueprint<S> => appendHook(bp, 'resuscitate', handler)
}

/**
 * Observes `adoptNode` while the session stays `Mounted`. Phase 1 of the
 * two-phase model: a pure, lazy, in-memory declaration with zero DOM access,
 * zero I/O, zero listeners, and zero handler execution. The handler runs in
 * FIFO order as observers and registry entries migrate documents; the call
 * is idempotent and never mutates inputs.
 *
 * @param handler Hook invoked with the adopted session and its new owner.
 * @returns A blueprint operator appending the registration.
 * @example
 * ```ts
 * import { createContext } from './create-context.js'
 * import { onAdopt } from './hooks.js'
 *
 * const blueprint = onAdopt((_session, _owner) => {
 *     console.log('adopted')
 * })(createContext({ count: 0 }))
 * console.log(blueprint.hooks.length)
 * ```
 */
export function onAdopt<S extends Record<PropertyKey, unknown>>(
    handler: (session: Session<S>, owner: unknown) => void,
): BlueprintOperator<S> {
    return (bp: ContextBlueprint<S>): ContextBlueprint<S> => appendHook(bp, 'adopt', handler)
}
