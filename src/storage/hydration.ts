import { readDomProperty } from '../bridge/property-path'
import type {
    HydrationStrategy,
    IBridgePropertyRule,
    IContextBlueprint
} from '../core/types'

/**
 * Extracts live DOM values for every bridge binding into a partial state.
 *
 * Iterates all `blueprint.bridges` in order, reads each bound path via
 * `readDomProperty()`, applies the rule-level `parse` codec when present, and
 * keeps the value unless it is `null`, `undefined`, or `''` (empty attributes
 * count as absent). Later bridges overwrite earlier ones on key collision.
 *
 * @param blueprint - Blueprint whose bridge bindings define the extraction.
 * @param element - Host element to read from.
 * @returns A partial state of DOM-sourced values (possibly empty).
 *
 * @example
 * ```ts
 * import { extractDomProperties } from '@sandlada/document-context'
 *
 * const domState = extractDomProperties(blueprint, element)
 * ```
 */
export function extractDomProperties<S extends Record<PropertyKey, any>>(
    blueprint: IContextBlueprint<S, any>,
    element: HTMLElement
): Partial<S> {
    const domState: Record<string, any> = {}

    for (const bridge of blueprint.bridges) {
        for (const [key, rule] of Object.entries(bridge.properties)) {
            if (!rule) continue
            const targetPath = typeof rule === 'string' ? rule : (rule as IBridgePropertyRule<S>).target
            const parse = typeof rule === 'object' ? (rule as IBridgePropertyRule<S>).parse : undefined

            const rawVal = readDomProperty(element, targetPath)
            if (rawVal !== null && rawVal !== undefined && rawVal !== '') {
                domState[key] = parse ? parse(rawVal) : rawVal
            }
        }
    }

    return domState as Partial<S>
}

/**
 * Merges blueprint seeds, live DOM values, and persisted storage into the
 * initial session state according to a precedence strategy.
 *
 * Pure function: reads DOM synchronously, allocates a fresh object, and never
 * touches the session. Non-object `storageData` is treated as `{}`. Spread
 * order (later wins) per strategy: `'storageFirst'` (default)
 * `{...blueprint, ...dom, ...storage}`; `'domFirst'` and `'merge'` are
 * currently identical, both `{...blueprint, ...storage, ...dom}`;
 * `'blueprintFirst'` is `{...dom, ...storage, ...blueprint}`.
 *
 * @param blueprint - Blueprint supplying `initialState` and bridge bindings.
 * @param element - Host element supplying live DOM values.
 * @param storageData - Deserialized persisted data, if any.
 * @param strategy - Precedence policy. Defaults to `'storageFirst'`.
 * @returns The hydrated initial state object.
 *
 * @example
 * ```ts
 * import { resolveHydratedState } from '@sandlada/document-context'
 *
 * const state = resolveHydratedState(blueprint, element, { count: 5 }, 'storageFirst')
 * ```
 */
export function resolveHydratedState<S extends Record<PropertyKey, any>>(
    blueprint: IContextBlueprint<S, any>,
    element: HTMLElement,
    storageData: Partial<S> | null | undefined,
    strategy: HydrationStrategy = 'storageFirst'
): S {
    const blueprintState = blueprint.initialState
    const domState = extractDomProperties(blueprint, element)
    const validStorage = storageData && typeof storageData === 'object' ? storageData : {}

    switch (strategy) {
        case 'domFirst':
            return {
                ...blueprintState,
                ...validStorage,
                ...domState
            }
        case 'blueprintFirst':
            return {
                ...domState,
                ...validStorage,
                ...blueprintState
            }
        case 'merge':
            return {
                ...blueprintState,
                ...validStorage,
                ...domState
            }
        case 'storageFirst':
        default:
            return {
                ...blueprintState,
                ...domState,
                ...validStorage
            }
    }
}
