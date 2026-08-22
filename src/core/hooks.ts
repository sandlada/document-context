import type {
    IContextBlueprint,
    ILifecycleHooks,
    LifecycleEventName
} from './types'

/**
 * Pure blueprint operator to register a lifecycle hook callback.
 *
 * @param event The target lifecycle event name ('mount', 'dispose', 'suspend', 'resuscitate', 'adopt').
 * @param handler The lifecycle handler callback.
 * @returns A higher-order blueprint transformer function.
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
