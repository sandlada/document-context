/**
 * Blueprint: the immutable Phase 1 description of a session.
 *
 * A blueprint is **data**. It can be computed without touching the DOM, without running a single
 * factory and without registering a listener. Everything an application needs — the dependency
 * graph, the eager set, the hook list — is derivable from it.
 */

import type { Session } from './session'
import type { TokenLike } from './token'

/** Caching behaviour of a provided dependency. */
export type ProviderLifecycle = 'scoped' | 'singleton' | 'transient' | 'prototype'

/** The lifecycle hooks a blueprint can declare. */
export type HookType = 'mount' | 'dispose' | 'suspend' | 'resume' | 'adopt'

/**
 * A hook callback.
 *
 * Returning a function registers a cleanup callback. Returning a promise makes `ready` (or the
 * async dispose) wait for it; a promise's resolved value is **not** treated as a cleanup callback.
 */
export type HookFn = (session: Session<any, any>) => void | (() => void) | Promise<void>

/** The tools handed to a provider factory. */
export interface FactoryTools {
    /** The session the factory belongs to. */
    readonly session: Session<any, any>
    /**
     * Read an already-created dependency.
     *
     * Only tokens declared through `uses` can be read, and only after they have been created.
     */
    readonly use: <U>(token: TokenLike<U>) => U
}

/** A provider factory. May return a value or a promise of one. */
export type Factory<T> = (tools: FactoryTools) => T | Promise<T>

/** A single `provide` registration, as stored on a blueprint. */
export interface ProviderRegistration {
    /** The token this registration answers to. */
    readonly token: TokenLike
    /** The factory that creates the value. */
    readonly factory: Factory<unknown>
    /** Caching behaviour. Defaults to `scoped`. */
    readonly lifecycle: ProviderLifecycle
    /** Whether the factory runs during initialization instead of on first injection. */
    readonly eager: boolean
    /** Whether `injectAll` collects this registration. */
    readonly multi: boolean
    /** Tokens that are created before this factory runs. */
    readonly uses: readonly TokenLike[]
    /** Blueprint registration order. Preserved for `injectAll`. */
    readonly order: number
}

/** A single hook registration, as stored on a blueprint. */
export interface HookRegistration {
    /** Which lifecycle moment this hook reacts to. */
    readonly type: HookType
    /** The callback. */
    readonly hook: HookFn
    /** Blueprint registration order. */
    readonly order: number
}

/**
 * The immutable Phase 1 description of a session.
 *
 * @typeParam S - The state shape.
 */
export interface Blueprint<S> {
    /** The seed state. Copied when the blueprint was created. */
    readonly state: S
    /** Provider registrations in blueprint registration order. */
    readonly providers: readonly ProviderRegistration[]
    /** Hook registrations in blueprint registration order. */
    readonly hooks: readonly HookRegistration[]
}

/** A pure blueprint operator. Blueprint operators never touch the DOM and never run a factory. */
export type BlueprintOperator<S> = (blueprint: Blueprint<S>) => Blueprint<S>

/**
 * Create the seed blueprint of a session.
 *
 * The initial state is **copied**, so later mutations of the caller's object cannot leak into the
 * session.
 *
 * @example
 * ```ts
 * import { createContext, mount, update, read } from '@sandlada/document-context'
 *
 * interface CartItem {
 *     readonly id: string
 *     readonly price: number
 * }
 * interface CartState {
 *     readonly items: readonly CartItem[]
 *     readonly total: number
 * }
 *
 * // Create pure immutable blueprint with seed state (zero DOM access in Phase 1)
 * const cartBlueprint = createContext<CartState>({ items: [], total: 0 })
 *
 * const host = document.getElementById('cart-container')!
 * const session = mount(cartBlueprint)(host)
 * await session.ready
 *
 * update<CartState>((s) => ({
 *     items: [...s.items, { id: 'item-1', price: 150 }],
 *     total: s.total + 150,
 * }))(session)
 *
 * const total = read<CartState, number>((s) => s.total)(session)
 * console.log(total) // 150
 * ```
 *
 * @param initial - The seed state.
 * @returns A frozen blueprint holding a copy of `initial`.
 */
export function createContext<S>(initial: S): Blueprint<S> {
    return Object.freeze({
        state: copyState(initial),
        providers: Object.freeze([]) as readonly ProviderRegistration[],
        hooks: Object.freeze([]) as readonly HookRegistration[],
    })
}

/**
 * Compose blueprint operators.
 *
 * @example
 * ```ts
 * import { createContext, pipe, onMount, mount, read, update } from '@sandlada/document-context'
 *
 * interface AuthState {
 *     readonly user: string | null
 *     readonly isAuthenticated: boolean
 * }
 *
 * // Compose state seed and lifecycle hooks into an immutable blueprint
 * const authBlueprint = pipe(
 *     createContext<AuthState>({ user: null, isAuthenticated: false }),
 *     onMount((session) => {
 *         update<AuthState>(() => ({ user: 'Ada', isAuthenticated: true }))(session)
 *     }),
 * )
 *
 * const host = document.getElementById('auth-root')!
 * const session = mount(authBlueprint)(host)
 * await session.ready
 *
 * console.log(read<AuthState, string | null>((s) => s.user)(session)) // 'Ada'
 * ```
 *
 * @param blueprint - The blueprint to start from.
 * @param operators - Operators applied left to right.
 * @returns A new blueprint; the input is never mutated.
 */
export function pipe<S>(
    blueprint: Blueprint<S>,
    ...operators: readonly BlueprintOperator<S>[]
): Blueprint<S> {
    return operators.reduce<Blueprint<S>>((current, operator) => operator(current), blueprint)
}

/**
 * Whether a value is a plain object (so that it can be deep-copied and deep-merged safely).
 *
 * @param value - The value to test.
 * @returns `true` for object literals and `Object.create(null)` values.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const prototype = Object.getPrototypeOf(value) as unknown
    return prototype === Object.prototype || prototype === null
}

/** Keys that must not be copied or merged. Assignment would change the prototype. */
export const NON_COPIED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Deep-copy plain objects and arrays, leaving every other value by reference.
 *
 * @param value - The value to copy.
 * @param seen - Internal cycle guard.
 * @returns The copied value.
 */
export function copyState<T>(value: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
    if (Array.isArray(value)) {
        const cached = seen.get(value)
        if (cached !== undefined) {
            return cached as T
        }
        const copy: unknown[] = []
        seen.set(value, copy)
        for (const item of value) {
            copy.push(copyState(item, seen))
        }
        return copy as unknown as T
    }
    if (isPlainObject(value)) {
        const cached = seen.get(value)
        if (cached !== undefined) {
            return cached as T
        }
        const copy: Record<string, unknown> = Object.create(
            Object.getPrototypeOf(value) as object | null,
        )
        seen.set(value, copy)
        for (const [key, item] of Object.entries(value)) {
            if (NON_COPIED_KEYS.has(key)) {
                continue
            }
            copy[key] = copyState(item, seen)
        }
        return copy as unknown as T
    }
    return value
}
