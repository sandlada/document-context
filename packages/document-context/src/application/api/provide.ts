/**
 * Blueprint provider operators: declare sync and async service factories.
 *
 * This module is pure: no DOM access, no timers, no I/O. It runs in a plain
 * Node environment. Operators record registrations only; factories never run
 * here (mount executes them).
 */
import { DocumentContextError } from '../../domain/model/errors.js'
import { validateTokenName } from '../../domain/model/token.js'
import type { PrivateToken, ServiceRegistry, ServiceToken, Token } from '../../domain/model/token.js'
import type { ContextBlueprint } from '../../domain/model/blueprint.js'
import type { ServiceLifecycle, ServiceRegistration } from '../../domain/model/service.js'
import type { Session } from '../../domain/model/session.js'

/**
 * Pure blueprint transformer. The canonical definition lives in `pipe.ts`;
 * this alias is structurally identical and local so this operator stays free
 * of sibling imports.
 */
type BlueprintOperator<S extends Record<PropertyKey, unknown>> = (bp: ContextBlueprint<S>) => ContextBlueprint<S>

/**
 * Options shared by `provide` and `provideSync`.
 */
export interface ProvideOptions {
    /**
     * Scope classification of the produced service. Defaults to `'scoped'`.
     */
    readonly lifecycle?: ServiceLifecycle
    /**
     * True when the registration accumulates for `injectAll` instead of
     * overwriting single-value resolution. Defaults to `false`.
     */
    readonly multi?: boolean
    /**
     * True when the service instantiates during mount before `onMount`.
     * Defaults to `false`.
     */
    readonly eager?: boolean
}

/**
 * Declares an async-first provider under a `ServiceRegistry` string key.
 *
 * @param token ServiceRegistry string-literal token.
 * @param asyncFactory Async factory invoked with the real session by mount.
 * @param options Lifecycle, multi, and eager flags.
 * @returns A blueprint operator recording the registration.
 */
export function provide<S extends Record<PropertyKey, unknown>, K extends keyof ServiceRegistry>(
    token: K,
    asyncFactory: (session: Session<S>) => Promise<ServiceRegistry[K]>,
    options?: ProvideOptions
): BlueprintOperator<S>
/**
 * Declares an async-first provider under an explicit branded token.
 *
 * @param token Branded public token carrying the service type.
 * @param asyncFactory Async factory invoked with the real session by mount.
 * @param options Lifecycle, multi, and eager flags.
 * @returns A blueprint operator recording the registration.
 */
export function provide<S extends Record<PropertyKey, unknown>, T>(
    token: ServiceToken<T>,
    asyncFactory: (session: Session<S>) => Promise<T>,
    options?: ProvideOptions
): BlueprintOperator<S>
/**
 * Declares an async-first provider under a private token.
 *
 * @param token Frozen private token exempt from namespace validation.
 * @param asyncFactory Async factory invoked with the real session by mount.
 * @param options Lifecycle, multi, and eager flags.
 * @returns A blueprint operator recording the registration.
 */
export function provide<S extends Record<PropertyKey, unknown>, T>(
    token: PrivateToken<T>,
    asyncFactory: (session: Session<S>) => Promise<T>,
    options?: ProvideOptions
): BlueprintOperator<S>
/**
 * Declares an async-first provider under a bare string (escape hatch).
 *
 * @param token Bare string token validated like `defineToken`.
 * @param asyncFactory Async factory invoked with the real session by mount.
 * @param options Lifecycle, multi, and eager flags.
 * @returns A blueprint operator recording the registration.
 */
export function provide<S extends Record<PropertyKey, unknown>>(
    token: string,
    asyncFactory: (session: Session<S>) => Promise<unknown>,
    options?: ProvideOptions
): BlueprintOperator<S>
/**
 * Declares an async-first (default) provider on a blueprint. Phase 1 of the
 * two-phase model: a pure, lazy, in-memory declaration with zero DOM access,
 * zero I/O, zero listeners, and zero factory execution. Applying the returned
 * operator copies the provider map and sets the token entry, leaving the
 * input blueprint untouched; the call is idempotent.
 *
 * A same-token single registration overwrites the previous entry. A repeated
 * `multi: true` registration likewise replaces the map entry: the domain
 * `ContextBlueprint.providers` shape is a single `ReadonlyMap<Token,
 * ServiceRegistration>` holding one entry per token, so blueprint-level
 * same-token accumulation is not representable; the surviving entry still
 * registers with `multi: true` for the `injectAll` family, and registry-level
 * accumulation applies to every entry mount receives.
 *
 * @param token Service token: a `ServiceRegistry` key, a branded
 * `ServiceToken`, an exempt `PrivateToken`, or a validated bare string.
 * @param asyncFactory Async factory invoked with the real session by mount,
 * never here.
 * @param options Lifecycle (`'scoped'` default), multi (`false` default),
 * and eager (`false` default) flags.
 * @returns A blueprint operator recording the registration.
 * @throws DocumentContextError with code `TOKEN_INVALID` when a string-form
 * token violates the namespace rules.
 * @example
 * ```ts
 * import { createContext } from './create-context.js'
 * import { defineToken } from '../../domain/model/token.js'
 * import { provide } from './provide.js'
 *
 * interface User { id: string }
 *
 * const userToken = defineToken<User>('app:user')
 * const blueprint = provide(userToken, async () => ({ id: 'u1' }))(createContext({ count: 0 }))
 * console.log(blueprint.providers.size)
 * ```
 */
export function provide<S extends Record<PropertyKey, unknown>>(
    token: Token,
    asyncFactory: (session: Session<S>) => Promise<unknown>,
    options?: ProvideOptions
): BlueprintOperator<S> {
    const normalized = normalizeToken(token)
    const registration: ServiceRegistration<unknown> = {
        token: normalized,
        factory: (session: unknown) => asyncFactory(session as Session<S>),
        lifecycle: options?.lifecycle ?? 'scoped',
        async: true,
        multi: options?.multi ?? false,
        eager: options?.eager ?? false,
    }
    return (bp: ContextBlueprint<S>): ContextBlueprint<S> => {
        const providers = new Map(bp.providers)
        providers.set(normalized, registration)
        return { ...bp, providers }
    }
}

/**
 * Declares a sync provider under a `ServiceRegistry` string key.
 *
 * @param token ServiceRegistry string-literal token.
 * @param factory Sync factory invoked with the real session by mount.
 * @param options Lifecycle, multi, and eager flags.
 * @returns A blueprint operator recording the registration.
 */
export function provideSync<S extends Record<PropertyKey, unknown>, K extends keyof ServiceRegistry>(
    token: K,
    factory: (session: Session<S>) => ServiceRegistry[K],
    options?: ProvideOptions
): BlueprintOperator<S>
/**
 * Declares a sync provider under an explicit branded token.
 *
 * @param token Branded public token carrying the service type.
 * @param factory Sync factory invoked with the real session by mount.
 * @param options Lifecycle, multi, and eager flags.
 * @returns A blueprint operator recording the registration.
 */
export function provideSync<S extends Record<PropertyKey, unknown>, T>(
    token: ServiceToken<T>,
    factory: (session: Session<S>) => T,
    options?: ProvideOptions
): BlueprintOperator<S>
/**
 * Declares a sync provider under a private token.
 *
 * @param token Frozen private token exempt from namespace validation.
 * @param factory Sync factory invoked with the real session by mount.
 * @param options Lifecycle, multi, and eager flags.
 * @returns A blueprint operator recording the registration.
 */
export function provideSync<S extends Record<PropertyKey, unknown>, T>(
    token: PrivateToken<T>,
    factory: (session: Session<S>) => T,
    options?: ProvideOptions
): BlueprintOperator<S>
/**
 * Declares a sync provider under a bare string (escape hatch).
 *
 * @param token Bare string token validated like `defineToken`.
 * @param factory Sync factory invoked with the real session by mount.
 * @param options Lifecycle, multi, and eager flags.
 * @returns A blueprint operator recording the registration.
 */
export function provideSync<S extends Record<PropertyKey, unknown>>(
    token: string,
    factory: (session: Session<S>) => unknown,
    options?: ProvideOptions
): BlueprintOperator<S>
/**
 * Declares a sync-factory provider on a blueprint. Phase 1 of the two-phase
 * model: a pure, lazy, in-memory declaration with zero DOM access, zero I/O,
 * zero listeners, and zero factory execution. Same map-copy and
 * same-token-overwrite semantics as `provide`, except the registration is
 * recorded with `async: false` so only sync resolution may consume it.
 *
 * @deprecated Second-tier sync projection: new code must use {@link provide}.
 * All `*Sync` APIs are deprecated for the whole `0.1.x` window and are
 * removed in `0.2.0`.
 * @param token Service token: a `ServiceRegistry` key, a branded
 * `ServiceToken`, an exempt `PrivateToken`, or a validated bare string.
 * @param factory Sync factory invoked with the real session by mount, never
 * here; it may only use sync resolution for dependencies that are ready.
 * @param options Lifecycle (`'scoped'` default), multi (`false` default),
 * and eager (`false` default) flags.
 * @returns A blueprint operator recording the registration.
 * @throws DocumentContextError with code `TOKEN_INVALID` when a string-form
 * token violates the namespace rules.
 * @example
 * ```ts
 * import { createContext } from './create-context.js'
 * import { defineToken } from '../../domain/model/token.js'
 * import { provideSync } from './provide.js'
 *
 * interface Logger { log: (message: string) => void }
 *
 * const loggerToken = defineToken<Logger>('app:logger')
 * const blueprint = provideSync(loggerToken, () => ({ log: (m: string) => console.log(m) }))(createContext({ count: 0 }))
 * console.log(blueprint.providers.size)
 * ```
 */
export function provideSync<S extends Record<PropertyKey, unknown>>(
    token: Token,
    factory: (session: Session<S>) => unknown,
    options?: ProvideOptions
): BlueprintOperator<S> {
    const normalized = normalizeToken(token)
    const registration: ServiceRegistration<unknown> = {
        token: normalized,
        factory: (session: unknown) => factory(session as Session<S>),
        lifecycle: options?.lifecycle ?? 'scoped',
        async: false,
        multi: options?.multi ?? false,
        eager: options?.eager ?? false,
    }
    return (bp: ContextBlueprint<S>): ContextBlueprint<S> => {
        const providers = new Map(bp.providers)
        providers.set(normalized, registration)
        return { ...bp, providers }
    }
}

/**
 * Normalizes an operator token: string-form tokens (branded or bare) pass
 * the shared namespace validator, private-token objects pass through
 * exempt, and anything else is rejected as `TOKEN_INVALID`.
 */
function normalizeToken(token: Token): Token {
    if (typeof token === 'string') {
        validateTokenName(token)
        return token
    }
    if (typeof token === 'object' && token !== null) {
        return token
    }
    throw new DocumentContextError('TOKEN_INVALID', { token, reason: 'not-a-string' })
}
