/**
 * Token identity.
 *
 * A **public** token is a plain `namespace:name` string at runtime. Two scripts that each call
 * `defineToken('public')('app:theme')` obtain the very same string, so cross-bundle resolution
 * never needs a shared module instance.
 *
 * A **private** token is an object reference. It only works inside one realm and one module graph.
 */

import { DocumentContextError } from './errors'

declare const tokenBrand: unique symbol
const privateTokenBrand: unique symbol = Symbol('document-context.private-token')

/**
 * A public token.
 *
 * At runtime this is the plain token name. The brand only exists so that TypeScript can carry the
 * service type; it is erased at build time.
 */
export type Token<T> = string & { readonly [tokenBrand]: T }

/**
 * A private token.
 *
 * Identity is reference equality. The brand property is not exported, so a private token can only be
 * produced by {@link defineToken}.
 */
export interface PrivateToken<T> {
    /** Debug-only label. Not validated, never used for resolution. */
    readonly name: string
    readonly [privateTokenBrand]: T
}

/** Any token accepted by `provide` / `inject`. */
export type TokenLike<T = unknown> = Token<T> | PrivateToken<T>

/** Visibility of a token definition. */
export type TokenVisibility = 'public' | 'private'

/**
 * Augment this interface to give bare-string injections a type.
 *
 * @example
 * ```ts
 * declare module '@sandlada/document-context' {
 *     interface ServiceRegistry {
 *         'app:theme': 'dark' | 'light'
 *     }
 * }
 * ```
 */
export interface ServiceRegistry {}

/** The service type registered for a token name, or `unknown` when the name is not registered. */
export type RegisteredService<K extends string> = K extends keyof ServiceRegistry
    ? ServiceRegistry[K]
    : unknown

const TOKEN_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Validate a public token name.
 *
 * @param name - The candidate name.
 * @throws {@link DocumentContextError} with code `TOKEN_INVALID` when the name is not `namespace:name`.
 */
export function validateTokenName(name: string): void {
    if (typeof name !== 'string' || !TOKEN_NAME_PATTERN.test(name)) {
        throw new DocumentContextError(
            'TOKEN_INVALID',
            `Invalid token name ${JSON.stringify(name)}: expected "namespace:name".`,
            { details: { name } },
        )
    }
}

/**
 * Whether the given value is a public token (a `namespace:name` string).
 *
 * @example
 * ```ts
 * import { defineToken, isPublicToken } from '@sandlada/document-context'
 *
 * const themeToken = defineToken<'light' | 'dark'>('public')('app:theme')
 * console.log(isPublicToken(themeToken)) // true
 * console.log(isPublicToken('invalid-bare-token')) // false
 * ```
 *
 * @param value - The value to test.
 * @returns `true` when `value` is a string shaped like a public token name.
 */
export function isPublicToken(value: unknown): value is Token<unknown> {
    return typeof value === 'string' && TOKEN_NAME_PATTERN.test(value)
}

/**
 * Whether the given value is a private token.
 *
 * @example
 * ```ts
 * import { defineToken, isPrivateToken } from '@sandlada/document-context'
 *
 * const secretToken = defineToken<{ secret: string }>('private')('auth:secret')
 * console.log(isPrivateToken(secretToken)) // true
 * console.log(isPrivateToken('app:theme')) // false
 * ```
 *
 * @param value - The value to test.
 * @returns `true` when `value` was produced by `defineToken('private')`.
 */
export function isPrivateToken(value: unknown): value is PrivateToken<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        'name' in value &&
        privateTokenBrand in (value as Record<symbol, unknown>)
    )
}

/**
 * Reject a public token whose name is not `namespace:name`.
 *
 * Private tokens skip the rule. Their identity is the object reference.
 *
 * @param token - The token to check.
 * @throws A `DocumentContextError` with code `TOKEN_INVALID` when a public token name is illegal.
 */
export function assertResolvableToken(token: TokenLike): void {
    if (isPrivateToken(token)) {
        return
    }
    validateTokenName(typeof token === 'string' ? token : '')
}

/**
 * Define a token.
 *
 * Visibility comes first, the name comes last. Omitting the visibility yields a public token.
 * Public tokens are strings matched across multiple script bundles. Private tokens are unique
 * object references confined to a single module realm.
 *
 * @example
 * ```ts
 * import { defineToken, createContext, pipe, provide, mount, inject } from '@sandlada/document-context'
 *
 * interface LoggerService {
 *     log(msg: string): void
 * }
 *
 * // Public token (accessible across micro-frontends / bundles via 'app:logger')
 * const loggerToken = defineToken<LoggerService>('public')('app:logger')
 *
 * // Private token (confined within this realm)
 * const internalSecretToken = defineToken<{ key: string }>('private')('auth:internal-key')
 *
 * const blueprint = pipe(
 *     createContext({}),
 *     provide(loggerToken, () => ({ log: (m) => console.log(`[APP]: ${m}`) })),
 *     provide(internalSecretToken, () => ({ key: 'secret_123' })),
 * )
 *
 * const host = document.getElementById('app')!
 * const session = mount(blueprint)(host)
 * await session.ready
 *
 * const logger = await inject(loggerToken)(host)
 * logger.log('System ready')
 * ```
 *
 * @param visibility - `'public'` (default) or `'private'`.
 * @returns A function that takes the token name and returns the token.
 */
export function defineToken<T>(visibility?: 'public'): (name: string) => Token<T>
export function defineToken<T>(visibility: 'private'): (name: string) => PrivateToken<T>
export function defineToken<T>(
    visibility: TokenVisibility = 'public',
): (name: string) => Token<T> | PrivateToken<T> {
    return (name: string): Token<T> | PrivateToken<T> => {
        if (visibility === 'private') {
            return { name, [privateTokenBrand]: undefined as unknown as T }
        }
        validateTokenName(name)
        return name as Token<T>
    }
}
