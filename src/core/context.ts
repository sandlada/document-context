import { isDev } from './session-internal'
import type { IContextBlueprint } from './types'

/**
 * Creates a pure, immutable blueprint seed for a context container (Phase 1).
 *
 * This is the entry point of the two-phase architecture. It performs zero DOM
 * access, zero I/O, and installs zero listeners: it only snapshots
 * `initialState` and returns an empty-provider blueprint that later operators
 * (`withProvider`, `withBridge`, `withStorage`, `withHook`) extend via `pipe`.
 * The single execution boundary is `mount(blueprint)(element)`.
 *
 * In development (`NODE_ENV !== 'production'`) the snapshot is shallow-frozen
 * with `Object.freeze({ ...initialState })` so accidental mutation throws
 * early; in production the reference is kept as-is for speed.
 *
 * @param initialState - Seed state object. Must be a plain record; it is
 * shallow-copied before freezing, so top-level reassignment by the caller
 * afterwards is safe but nested objects stay shared.
 * @returns A pure `IContextBlueprint<S, {}>` with empty providers, bridges,
 * storage, and hooks.
 *
 * @example
 * ```ts
 * import { createContext, pipe, withProvider, mount } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     createContext({ count: 0, theme: 'light' as 'light' | 'dark' }),
 *     withProvider('logger', () => new ConsoleLogger())
 * )
 * const session = mount(blueprint)(document.getElementById('app')!)
 * ```
 */
export function createContext<S extends Record<PropertyKey, any>>(
    initialState: S
): IContextBlueprint<S, {}> {
    const frozenState = isDev() ? Object.freeze({ ...initialState }) : initialState

    return {
        initialState: frozenState,
        providers: new Map(),
        bridges: [],
        storage: undefined,
        hooks: []
    }
}
