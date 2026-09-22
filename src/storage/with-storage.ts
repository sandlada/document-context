import type { IContextBlueprint, ISession, IStorageOptions } from '../core/types'
import { setupStorage } from './sync'

/**
 * Pure Phase 1 operator that registers persistence and hydration options.
 *
 * Stores `options` on `blueprint.storage` (replacing any previous storage
 * config) and adds a `mount` hook invoking
 * `setupStorage(session, options)`. The operator itself performs no I/O; all
 * reads, writes, and channel subscriptions start at mount.
 *
 * @param options - Storage configuration; see {@link IStorageOptions}.
 * Adapter, key, hydration strategy, cross-tab sync, version, and migrate are
 * all captured here.
 * @returns A blueprint transformer preserving state and service types.
 *
 * @example
 * ```ts
 * import { withStorage } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     createContext({ count: 0 }),
 *     withStorage({ adapter: 'localStorage', key: 'counter-app', version: 1 })
 * )
 * ```
 */
export function withStorage<S extends Record<PropertyKey, any> = Record<PropertyKey, any>, Services = {}>(
    options: IStorageOptions<S>
): <ActualState extends S, ActualServices extends Services>(
    blueprint: IContextBlueprint<ActualState, ActualServices>
) => IContextBlueprint<ActualState, ActualServices> {
    return (blueprint) => ({
        ...blueprint,
        storage: options as IStorageOptions<any>,
        hooks: [
            ...blueprint.hooks,
            {
                event: 'mount',
                handler: (session: ISession<any, any>) =>
                    setupStorage(session, options as IStorageOptions<any>)
            }
        ]
    })
}
