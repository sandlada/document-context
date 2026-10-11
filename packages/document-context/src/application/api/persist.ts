/**
 * `persist` blueprint operator: pure persistence declaration.
 *
 * This module is pure: no DOM access, no timers, no I/O. It only returns a
 * new blueprint carrying the given storage options, so it runs in a plain
 * Node environment. Storage backends resolve at mount time through the
 * application `StorageRegistry`.
 */

import type { ContextBlueprint, StorageOptions } from '../../domain/index.js'

/**
 * Declares persistence for a blueprint: returns a data-last operator mapping
 * the input blueprint to a new blueprint whose `storage` slot carries a copy
 * of `options`. The input blueprint is never mutated; applying `persist`
 * twice keeps only the latest options.
 *
 * The operator type is structurally identical to the canonical
 * `BlueprintOperator` owned by `pipe` (parallel track): an anonymous function
 * type is used here so this module compiles and ships independently.
 *
 * @param options Persistence options: backend keyword or custom port, key,
 * hydration precedence, version, migration, cross-tab, and conflict policy.
 * @returns Data-last operator producing the storing blueprint.
 * @example
 * ```ts
 * import { persist } from './persist.js'
 *
 * const storing = persist({ storage: 'localStorage', key: 'counter' })(blueprint)
 * ```
 */
export function persist<S extends Record<PropertyKey, unknown>>(
    options: StorageOptions<S>,
): (blueprint: ContextBlueprint<S>) => ContextBlueprint<S> {
    // The blueprint slot holds `Readonly<StorageOptions>` (default state
    // shape). The object is stored as given; only the static view widens,
    // because the `conflict` function is invariant under `S` while the
    // runtime shape is identical.
    const storage = { ...options } as unknown as Readonly<StorageOptions>
    return (blueprint: ContextBlueprint<S>): ContextBlueprint<S> => ({
        ...blueprint,
        storage,
    })
}
