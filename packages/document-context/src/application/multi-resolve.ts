/**
 * Multi-value injection ordering helpers.
 */

import type { ApplicationRuntime, InjectDirection } from './context'
import { resolveProviderValue, type MultiGroup } from './resolver'

/**
 * Resolve every registration in each group along the scope chain.
 *
 * @param runtime - The application runtime.
 * @param groups - The located multi groups.
 * @param direction - The order along the scope chain.
 * @returns The resolved values.
 */
export async function resolveMultiGroups(
    runtime: ApplicationRuntime,
    groups: readonly MultiGroup[],
    direction: InjectDirection,
): Promise<unknown[]> {
    const ordered = direction === 'from-top-to-bottom' ? [...groups].reverse() : groups
    const values: unknown[] = []
    for (const group of ordered) {
        for (const registration of group.registrations) {
            values.push(await resolveProviderValue(runtime, group.session, registration))
        }
    }
    return values
}

/**
 * Settle cross-application multi-value results and apply scope direction.
 *
 * Host groups reverse. Values inside one host stay in the order the provider emitted them.
 *
 * @param groups - The values grouped by host, nearest group first.
 * @param direction - The order along the scope chain.
 * @returns The settled values in the requested order.
 */
export async function settleInjectGroups(
    groups: readonly (readonly unknown[])[],
    direction: InjectDirection,
): Promise<unknown[]> {
    const ordered = direction === 'from-top-to-bottom' ? [...groups].reverse() : groups
    return Promise.all(ordered.flat())
}
