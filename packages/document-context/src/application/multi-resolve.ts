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
 * @param values - The raw values from the scope transport.
 * @param direction - The order along the scope chain.
 * @returns The settled values in the requested order.
 */
export async function settleInjectValues(
    values: unknown[],
    direction: InjectDirection,
): Promise<unknown[]> {
    const settled = await Promise.all(values)
    return direction === 'from-top-to-bottom' ? settled.reverse() : settled
}
