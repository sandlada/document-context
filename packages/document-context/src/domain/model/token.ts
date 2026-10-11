/**
 * Serializable, SSR-safe token system for service resolution and keyed
 * session identity.
 *
 * Public tokens are branded strings: their runtime is a plain string, so
 * equality is string equality across bundles, realms, and documents with no
 * global registry. Private tokens are frozen branded objects: equality is
 * reference equality within one realm and they can never serialize.
 *
 * This module is pure: no DOM access, no timers, no module-global mutable
 * state. It runs in a plain Node environment.
 */
import { DocumentContextError } from './errors.js'

declare const ServiceType: unique symbol

/**
 * Public service token: a branded string whose runtime is the name itself.
 * The phantom type carries the service type for typed injection; it never
 * affects runtime equality.
 */
export type ServiceToken<T> = string & { readonly [ServiceType]?: T }

declare const PrivateServiceType: unique symbol

/**
 * Private token: a frozen branded object. `name` is debug-only metadata; it
 * is exempt from namespace validation and never constitutes identity.
 */
export interface PrivateToken<T> {
    readonly [PrivateServiceType]?: T
    /** Debug-only label; not identity, never serialized. */
    readonly name: string
}

/**
 * Union accepted by ports and signatures. Keyed and serialized paths accept
 * only the public string form; private tokens are rejected there.
 *
 * `unknown` (rather than `any`) keeps assignability one-directional: a
 * `ServiceToken<User>` fits, but a bare `Token` does not silently become one.
 */
export type Token = ServiceToken<unknown> | PrivateToken<unknown> | string

/**
 * Open interface for declaration merging. Consumers augment it to give
 * string-literal tokens static types alongside `ServiceToken<T>`.
 */
export interface ServiceRegistry {}

const TOKEN_PATTERN = /^[A-Za-z0-9._:/-]+$/
const TOKEN_MAX_LENGTH = 256
const TOKEN_BLOCKED_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor'])
const TOKEN_RESERVED_NAMESPACES: ReadonlySet<string> = new Set(['__system__', '__document-context__'])

/**
 * Single source of truth for public token-name validation. Shared by
 * `defineToken` and keyed session identity normalization: both reject with
 * `TOKEN_INVALID` carrying `{token, reason}` details.
 *
 * Rules: `namespace:name` with at least two non-empty `:`-separated
 * segments, charset `[A-Za-z0-9._:/-]`, length at most 256, no
 * `__proto__`/`prototype`/`constructor` segment, and no reserved first
 * segment (`__system__`/`__document-context__`).
 *
 * @param name Candidate public token name (bare strings included).
 * @returns Nothing on success.
 * @throws DocumentContextError with code `TOKEN_INVALID` on any violation.
 * @example
 * ```ts
 * import { validateTokenName } from './token.js'
 *
 * validateTokenName('app:user')
 * ```
 */
export function validateTokenName(name: string): void {
    if (typeof name !== 'string') {
        throw new DocumentContextError('TOKEN_INVALID', { token: name, reason: 'not-a-string' })
    }
    if (name.length === 0) {
        throw new DocumentContextError('TOKEN_INVALID', { token: name, reason: 'empty' })
    }
    if (name.length > TOKEN_MAX_LENGTH) {
        throw new DocumentContextError('TOKEN_INVALID', { token: name, reason: 'too-long' })
    }
    if (!TOKEN_PATTERN.test(name)) {
        throw new DocumentContextError('TOKEN_INVALID', { token: name, reason: 'invalid-charset' })
    }
    const segments = name.split(':')
    if (segments.length < 2) {
        throw new DocumentContextError('TOKEN_INVALID', { token: name, reason: 'missing-namespace' })
    }
    if (segments.some((segment) => segment.length === 0)) {
        throw new DocumentContextError('TOKEN_INVALID', { token: name, reason: 'empty-segment' })
    }
    if (segments.some((segment) => TOKEN_BLOCKED_SEGMENTS.has(segment))) {
        throw new DocumentContextError('TOKEN_INVALID', { token: name, reason: 'blacklisted-segment' })
    }
    const first = segments[0]
    if (first !== undefined && TOKEN_RESERVED_NAMESPACES.has(first)) {
        throw new DocumentContextError('TOKEN_INVALID', { token: name, reason: 'reserved-namespace' })
    }
}

/**
 * Defines a public token. Pure and idempotent: defining the same name twice
 * (including from scattered bundles) is not an error and yields equal
 * tokens, because equality is string equality.
 *
 * @param name Public token name; runtime-validated by `validateTokenName`.
 * @returns The token, whose runtime is the name string itself.
 * @throws DocumentContextError with code `TOKEN_INVALID` on any violation.
 * @example
 * ```ts
 * import { defineToken } from './token.js'
 *
 * interface User { id: string }
 * const userToken = defineToken<User>('app:user')
 * ```
 */
export function defineToken<T = unknown>(name: string): ServiceToken<T> {
    validateTokenName(name)
    return name as ServiceToken<T>
}

/**
 * Defines a private token. The name is debug-only: it skips namespace
 * validation entirely and never participates in serialization. Each call
 * yields a distinct frozen object, so identity is reference equality within
 * this realm.
 *
 * @param name Debug-only label with no validation and no identity role.
 * @returns A new frozen private token, distinct from every other.
 * @example
 * ```ts
 * import { definePrivateToken } from './token.js'
 *
 * const secret = definePrivateToken('app:session-secret')
 * ```
 */
export function definePrivateToken<T = unknown>(name: string): PrivateToken<T> {
    return Object.freeze({ name }) as PrivateToken<T>
}
