import type {
    IContextBlueprint,
    ILifecycleHooks,
    LifecycleEventName
} from './types'

/**
 * Pure Phase 1 operator that registers a lifecycle hook callback.
 *
 * Appends `{ event, handler }` to `blueprint.hooks` with structural sharing.
 * Multiple calls for the same event accumulate: `mount` handlers run FIFO,
 * `dispose` handlers run LIFO. Valid events are `mount`, `dispose`,
 * `suspend`, `resuscitate`, and `adopt`; the handler signature is checked
 * against `ILifecycleHooks<S, Services>[Event]`.
 *
 * @param event - Target lifecycle channel.
 * @param handler - Lifecycle callback for that channel. `mount` may return a
 * cleanup (or a promise of one); `resuscitate` receives `(session, newTarget)`;
 * `adopt` receives `(session, newDocument)`.
 * @returns A blueprint transformer preserving `S` and `Services`.
 *
 * @example
 * ```ts
 * import { withHook } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     base,
 *     withHook('mount', (session) => {
 *         const timer = setInterval(() => console.log('tick'), 1000)
 *         return () => clearInterval(timer)
 *     })
 * )
 * ```
 */
export function withHook<
    Event extends LifecycleEventName,
    S extends Record<PropertyKey, any>,
    Services
>(
    event: Event,
    handler: NonNullable<ILifecycleHooks<S, Services>[Event]>
): (blueprint: IContextBlueprint<S, Services>) => IContextBlueprint<S, Services> {
    return (blueprint) => ({
        ...blueprint,
        hooks: [...blueprint.hooks, { event, handler }]
    })
}
