import { readDomProperty } from '../bridge/property-path'
import type {
    HydrationStrategy,
    IBridgePropertyRule,
    IContextBlueprint
} from '../core/types'

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
 * Resolves initial hydrated state using hydration precedence hierarchy.
 *
 * @param blueprint Context blueprint definition.
 * @param element Target HTMLElement.
 * @param storageData Persisted storage data (if any).
 * @param strategy Hydration strategy.
 * @returns Hydrated state object.
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
