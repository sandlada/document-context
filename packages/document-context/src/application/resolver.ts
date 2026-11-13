/**
 * Provider resolution.
 *
 * Resolution has two layers. Inside one application the scope chain is walked through the in-memory
 * index; across applications the Context Protocol event bus carries the request. Nearest-wins holds
 * in both layers.
 */

import { DocumentContextError } from '../domain/model/errors'
import type { FactoryTools, ProviderRegistration } from '../domain/model/blueprint'
import type { ContextRequestDetail } from '../domain/ports/scope-transport'
import { contextRequestSource } from '../domain/ports/scope-transport'
import type { Host } from '../domain/model/session'
import type { TokenLike } from '../domain/model/token'
import type { ApplicationRuntime } from './context'
import type { SessionRuntime } from './session'
import { cacheFor, cacheKey, isWinningSingleton } from './scopes/lifecycle'

/** A provider group of one host, used by `injectAll`. */
export interface MultiGroup {
    /** The session owning the registrations. */
    readonly session: SessionRuntime<any>
    /** The registrations in blueprint order. */
    readonly registrations: readonly ProviderRegistration[]
}

/** Where a single-value dependency was found. */
export type SingleLocation =
    | {
          readonly kind: 'local'
          readonly session: SessionRuntime<any>
          readonly registration: ProviderRegistration
      }
    | { readonly kind: 'foreign' }
    | { readonly kind: 'none' }

/** Where a multi-value dependency was found. */
export type MultiLocation =
    | { readonly kind: 'local'; readonly groups: readonly MultiGroup[] }
    | { readonly kind: 'foreign' }
    | { readonly kind: 'none' }

/**
 * The display name of a token.
 *
 * @param token - The token.
 * @returns The public name, or the debug name of a private token.
 */
export function tokenName(token: TokenLike): string {
    return typeof token === 'string' ? token : token.name
}

/**
 * The composed ancestor chain of a host, nearest first.
 *
 * @param host - The host to start from.
 * @returns The chain, ending with the outermost host.
 */
export function chainFrom(host: Host): Host[] {
    const chain: Host[] = []
    const seen = new Set<Host>()
    let current: Host | null = host
    while (current !== null && !seen.has(current)) {
        seen.add(current)
        chain.push(current)
        current = current.parent
    }
    return chain
}

/**
 * The last single-value registration of a token in a blueprint.
 *
 * Later registrations override earlier ones. `multi: true` registrations are **not** single-value
 * registrations: they accumulate for `injectAll` and never answer a single-value `inject`.
 *
 * @param session - The session.
 * @param token - The token.
 * @returns The registration, or `undefined`.
 */
export function lastSingleRegistration(
    session: SessionRuntime<any>,
    token: TokenLike,
): ProviderRegistration | undefined {
    let found: ProviderRegistration | undefined
    for (const registration of session.blueprint.providers) {
        if (registration.token === token && !registration.multi) {
            found = registration
        }
    }
    return found
}

/**
 * Locate the nearest single-value provider of a token.
 *
 * @param runtime - The application runtime.
 * @param from - The host the resolution starts from.
 * @param token - The token to resolve.
 * @param origin - The session that started the resolution, if any.
 * @returns Where the provider was found.
 */
export function locateSingle(
    runtime: ApplicationRuntime,
    from: Host,
    token: TokenLike,
    origin: SessionRuntime<any> | null,
): SingleLocation {
    if (origin !== null) {
        const own = lastSingleRegistration(origin, token)
        if (own !== undefined) {
            const owned = singletonWinner(runtime, origin, own)
            if (
                owned !== undefined &&
                (owned.session.status === 'active' || owned.session === origin)
            ) {
                return { kind: 'local', session: owned.session, registration: owned.registration }
            }
        }
    }
    const scope = runtime.ports.host.scope
    for (const host of chainFrom(from)) {
        const declaration = scope
            .declarationsOf(host)
            .find((entry) => entry.token === token && !entry.multi)
        if (declaration === undefined) {
            continue
        }
        if (declaration.owner !== runtime) {
            return { kind: 'foreign' }
        }
        const session = runtime.sessions.get(host)
        if (session === undefined) {
            continue
        }
        if (session.status !== 'active' && session !== origin) {
            continue
        }
        const registration = lastSingleRegistration(session, token)
        if (registration === undefined) {
            continue
        }
        const owned = singletonWinner(runtime, session, registration)
        if (owned === undefined) {
            continue
        }
        if (owned.session.status !== 'active' && owned.session !== origin) {
            continue
        }
        return { kind: 'local', session: owned.session, registration: owned.registration }
    }
    return { kind: 'none' }
}

/**
 * A single-value factory that has already started and has not finished.
 *
 * Element injection cannot see a session until it is `active`, but a factory that is already
 * running still has to be shared — or rejected, when the caller is that factory.
 *
 * @param runtime - The application runtime.
 * @param from - The host the resolution starts from.
 * @param token - The token to resolve.
 * @returns The in-flight registration, or `undefined`.
 */
export function findInFlightRegistration(
    runtime: ApplicationRuntime,
    from: Host,
    token: TokenLike,
): { session: SessionRuntime<any>; registration: ProviderRegistration } | undefined {
    for (const host of chainFrom(from)) {
        const session = runtime.sessions.get(host)
        if (session === undefined) {
            continue
        }
        const registration = lastSingleRegistration(session, token)
        if (registration === undefined || !session.resolving.has(registration)) {
            continue
        }
        return { session, registration }
    }
    return undefined
}

/**
 * Multi-value factories that have already started and have not finished.
 *
 * Groups stay in nearest-first order. A caller that is one of those factories is rejected when
 * the value is resolved; an outside caller shares the in-flight promises.
 *
 * @param runtime - The application runtime.
 * @param from - The host the resolution starts from.
 * @param token - The token to collect.
 * @returns The in-flight groups, nearest first.
 */
export function findInFlightMultiGroups(
    runtime: ApplicationRuntime,
    from: Host,
    token: TokenLike,
): MultiGroup[] {
    const groups: MultiGroup[] = []
    for (const host of chainFrom(from)) {
        const session = runtime.sessions.get(host)
        if (session === undefined) {
            continue
        }
        const registrations = session.blueprint.providers.filter(
            (registration) =>
                registration.token === token &&
                registration.multi &&
                session.resolving.has(registration) &&
                isWinningSingleton(runtime, registration),
        )
        if (registrations.length === 0) {
            continue
        }
        groups.push({ session, registrations })
    }
    return groups
}

/**
 * A singleton is owned by the first session that registered it.
 *
 * A later registration is ignored at resolution time, not only reported on `errors$`.
 *
 * @param runtime - The application runtime.
 * @param session - The session that holds the registration we found.
 * @param registration - The registration.
 * @returns The registration that is allowed to produce the value.
 */
function singletonWinner(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
    registration: ProviderRegistration,
): { session: SessionRuntime<any>; registration: ProviderRegistration } | undefined {
    if (registration.lifecycle !== 'singleton') {
        return { session, registration }
    }
    const winner = runtime.singletonRegistrations.get(registration.token)
    const owner = runtime.singletonOwners.get(registration.token)
    if (winner === undefined || owner === undefined) {
        return { session, registration }
    }
    if (winner === registration) {
        return { session: owner, registration }
    }
    // A multi singleton owns the token. It does not answer single-value inject, and a later
    // single-value registration must not run its factory.
    if (winner.multi) {
        return undefined
    }
    return { session: owner, registration: winner }
}

/**
 * Locate every multi-value provider of a token along the scope chain.
 *
 * @param runtime - The application runtime.
 * @param from - The host the resolution starts from.
 * @param token - The token to resolve.
 * @param origin - The session that started the resolution, if any.
 * @returns Where the providers were found.
 */
export function locateMulti(
    runtime: ApplicationRuntime,
    from: Host,
    token: TokenLike,
    origin: SessionRuntime<any> | null,
): MultiLocation {
    const groups: MultiGroup[] = []
    const scope = runtime.ports.host.scope
    for (const host of chainFrom(from)) {
        const declaration = scope
            .declarationsOf(host)
            .find((entry) => entry.token === token && entry.multi)
        if (declaration === undefined) {
            continue
        }
        if (declaration.owner !== runtime) {
            return { kind: 'foreign' }
        }
        const session = runtime.sessions.get(host)
        if (session === undefined) {
            continue
        }
        if (session.status !== 'active' && session !== origin) {
            continue
        }
        const registrations = session.blueprint.providers.filter(
            (registration) =>
                registration.token === token &&
                registration.multi &&
                isWinningSingleton(runtime, registration),
        )
        if (registrations.length === 0) {
            continue
        }
        if (!groups.some((group) => group.session === session)) {
            groups.push({ session, registrations })
        }
    }
    if (groups.length > 0) {
        return { kind: 'local', groups }
    }
    return { kind: 'none' }
}

/**
 * Dispatch a `context-request` through the Context Protocol bus.
 *
 * @param runtime - The application runtime.
 * @param from - The host the request originates from.
 * @param token - The token to request. Private tokens never leave the application.
 * @param multi - Whether every provider should answer.
 * @returns The values collected during the dispatch.
 */
export function dispatchRequest(
    runtime: ApplicationRuntime,
    from: Host,
    token: TokenLike,
    multi: boolean,
): unknown[] {
    if (typeof token !== 'string') {
        return []
    }
    const values: unknown[] = []
    const detail: ContextRequestDetail = {
        context: token,
        multi,
        callback: (value: unknown) => {
            values.push(value)
        },
    }
    runtime.ports.host.scope.request(from, detail)
    return values
}

/**
 * Dispatch a multi-value `context-request`, keeping each host's callbacks together.
 *
 * Reversing the result reverses host groups only. Values from one host stay in registration order.
 *
 * @param runtime - The application runtime.
 * @param from - The host the request originates from.
 * @param token - The token to request.
 * @returns The values grouped by host, nearest group first.
 */
export function dispatchMultiRequest(
    runtime: ApplicationRuntime,
    from: Host,
    token: TokenLike,
): unknown[][] {
    if (typeof token !== 'string') {
        return []
    }
    const groups: unknown[][] = []
    let currentSource: unknown
    let currentGroup: unknown[] | undefined
    const detail: ContextRequestDetail = {
        context: token,
        multi: true,
        callback: (value: unknown) => {
            const source = (detail as ContextRequestDetail & Record<symbol, unknown>)[
                contextRequestSource
            ]
            if (currentGroup === undefined || source === undefined || source !== currentSource) {
                currentGroup = [value]
                groups.push(currentGroup)
                currentSource = source
            } else {
                currentGroup.push(value)
            }
        },
    }
    runtime.ports.host.scope.request(from, detail)
    return groups
}

const factoryMarkers = new WeakMap<ProviderRegistration, string>()
let factoryMarkerSerial = 0

/**
 * A name that shows up on the async stack while this registration's factory is running.
 * An outside caller joining an in-flight promise does not have this frame; a factory that
 * awaited and then called back into the same registration does.
 *
 * @param registration - The registration whose factory is running.
 * @returns The marker.
 */
function factoryMarker(registration: ProviderRegistration): string {
    let marker = factoryMarkers.get(registration)
    if (marker === undefined) {
        factoryMarkerSerial += 1
        marker = `documentContextFactory#${factoryMarkerSerial}`
        factoryMarkers.set(registration, marker)
    }
    return marker
}

/**
 * Whether `registration`'s factory is an ancestor of the current call.
 *
 * @param registration - The registration being requested again.
 * @returns `true` when the wait has circled back to that factory.
 */
function factoryIsAncestor(registration: ProviderRegistration): boolean {
    const previousLimit = Error.stackTraceLimit
    Error.stackTraceLimit = Number.POSITIVE_INFINITY
    const stack = new Error().stack
    Error.stackTraceLimit = previousLimit
    if (stack === undefined) {
        return false
    }
    const marker = factoryMarker(registration)
    return stack.includes(`${marker} `)
        || stack.includes(`${marker}(`)
        || stack.includes(`${marker}@`)
}

function followSessionAbort(
    session: SessionRuntime<any>,
    promise: Promise<unknown>,
): Promise<unknown> {
    if (session.abortSignal.aborted) {
        return Promise.reject(disposalError(session))
    }
    return new Promise((resolve, reject) => {
        let settled = false
        const finish = (settle: () => void): void => {
            if (settled) {
                return
            }
            settled = true
            session.abortSignal.removeEventListener('abort', onAbort)
            settle()
        }
        const onAbort = (): void => {
            finish(() => {
                reject(disposalError(session))
            })
        }
        session.abortSignal.addEventListener('abort', onAbort, { once: true })
        promise.then(
            (value) => {
                finish(() => {
                    resolve(value)
                })
            },
            (error: unknown) => {
                finish(() => {
                    reject(error)
                })
            },
        )
    })
}

function disposalError(session: SessionRuntime<any>): DocumentContextError {
    const reason = session.abortSignal.reason
    if (reason instanceof DocumentContextError) {
        return reason
    }
    return new DocumentContextError(
        'DISPOSED_SESSION',
        'The session was disposed before the injection could finish.',
    )
}

/**
 * Resolve the value of a provider registration, honouring its lifecycle.
 *
 * The returned promise follows the session's abort boundary. Disposing the session rejects an
 * in-flight wait with `DISPOSED_SESSION`. Unsubscribing one caller does not cancel the factory.
 *
 * @param runtime - The application runtime.
 * @param session - The session the registration belongs to.
 * @param registration - The registration.
 * @returns The value.
 */
export function resolveProviderValue(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
    registration: ProviderRegistration,
): Promise<unknown> {
    if (session.abortSignal.aborted) {
        return Promise.reject(disposalError(session))
    }
    return followSessionAbort(session, produceProviderValue(runtime, session, registration))
}

async function produceProviderValue(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
    registration: ProviderRegistration,
): Promise<unknown> {
    if (registration.lifecycle === 'transient' || registration.lifecycle === 'prototype') {
        return runFactory(runtime, session, registration)
    }
    const cache = cacheFor(runtime, session, registration.lifecycle)
    const key = cacheKey(registration)
    let slot = cache.get(key)
    if (slot === undefined) {
        slot = { resolved: false }
        cache.set(key, slot)
    }
    if (slot.resolved) {
        return slot.value
    }
    if (slot.promise === undefined) {
        const promise = runFactory(runtime, session, registration)
        slot.promise = promise
        void promise.catch(() => {
            if (cache.get(key) === slot) {
                cache.delete(key)
            }
        })
    } else if (session.resolving.has(registration) && factoryIsAncestor(registration)) {
        throw new DocumentContextError(
            'CIRCULAR_DEPENDENCY',
            `Circular dependency detected for token "${tokenName(registration.token)}".`,
            { details: { token: tokenName(registration.token) } },
        )
    }
    return slot.promise
}

async function resolveDeclaredUses(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
    registration: ProviderRegistration,
): Promise<ReadonlyMap<TokenLike, unknown>> {
    try {
        const resolved = new Map<TokenLike, unknown>()
        for (const used of registration.uses) {
            resolved.set(used, await resolveUsedValue(runtime, session, used))
        }
        session.usedValues.set(registration, resolved)
        return resolved
    } finally {
        session.pendingUses.delete(registration)
    }
}

async function runFactory(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
    registration: ProviderRegistration,
): Promise<unknown> {
    const token = registration.token
    if (session.resolving.has(registration)) {
        const overlappingFactory =
            (registration.lifecycle === 'transient' || registration.lifecycle === 'prototype')
            && !factoryIsAncestor(registration)
        if (!overlappingFactory) {
            throw new DocumentContextError(
                'CIRCULAR_DEPENDENCY',
                `Circular dependency detected for token "${tokenName(token)}".`,
                { details: { token: tokenName(token) } },
            )
        }
    }
    session.resolving.add(registration)
    session.resolvingDepth.set(registration, (session.resolvingDepth.get(registration) ?? 0) + 1)
    try {
        const cached = session.usedValues.get(registration)
        let resolved: Map<TokenLike, unknown>
        if (cached !== undefined) {
            resolved = new Map(cached)
        } else if (registration.uses.length === 0) {
            resolved = new Map()
        } else {
            let inflight = session.pendingUses.get(registration)
            if (inflight === undefined) {
                inflight = resolveDeclaredUses(runtime, session, registration)
                session.pendingUses.set(registration, inflight)
            }
            resolved = new Map(await inflight)
        }
        const tools: FactoryTools = {
            session,
            use: <U>(requested: TokenLike<U>): U => {
                if (!resolved.has(requested)) {
                    throw new DocumentContextError(
                        'UNKNOWN_SERVICE',
                        `Token "${tokenName(requested)}" was not declared in "uses".`,
                        { details: { token: tokenName(requested) } },
                    )
                }
                return resolved.get(requested) as U
            },
        }
        const marker = factoryMarker(registration)
        const drive: Record<string, () => Promise<unknown>> = {
            async [marker](): Promise<unknown> {
                return await registration.factory(tools)
            },
        }
        const run = drive[marker]
        if (run === undefined) {
            return await registration.factory(tools)
        }
        return await run()
    } finally {
        const depth = (session.resolvingDepth.get(registration) ?? 1) - 1
        if (depth <= 0) {
            session.resolvingDepth.delete(registration)
            session.resolving.delete(registration)
        } else {
            session.resolvingDepth.set(registration, depth)
        }
    }
}

function nearestStartingProvider(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
    token: TokenLike,
): { session: SessionRuntime<any>; registration: ProviderRegistration } | undefined {
    const scope = runtime.ports.host.scope
    for (const host of chainFrom(session.adapterHost)) {
        const current = runtime.sessions.get(host)
        if (current !== undefined && current !== session && current.status === 'starting') {
            const registration = lastSingleRegistration(current, token)
            if (registration !== undefined) {
                const owned = singletonWinner(runtime, current, registration)
                if (
                    owned !== undefined &&
                    (owned.session.status === 'starting' || owned.session.status === 'active')
                ) {
                    return owned
                }
            }
        }
        const declared = scope
            .declarationsOf(host)
            .some((entry) => entry.token === token && !entry.multi)
        if (declared) {
            return undefined
        }
    }
    return undefined
}

/**
 * Resolve a dependency declared through `uses`.
 *
 * A provider on an ancestor that is still `starting` is part of the declared graph. `uses` waits
 * for that factory instead of failing `UNKNOWN_SERVICE`. Element `inject` still waits until the
 * provider is `active`.
 *
 * @param runtime - The application runtime.
 * @param session - The session that declares the dependency.
 * @param token - The declared token.
 * @returns The value.
 * @throws A `DocumentContextError` with code `UNKNOWN_SERVICE` when the token cannot be resolved.
 */
export async function resolveUsedValue(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
    token: TokenLike,
): Promise<unknown> {
    const own = lastSingleRegistration(session, token)
    if (own !== undefined) {
        const owned = singletonWinner(runtime, session, own)
        if (owned !== undefined) {
            return resolveProviderValue(runtime, owned.session, owned.registration)
        }
    }
    const starting = nearestStartingProvider(runtime, session, token)
    if (starting !== undefined) {
        return resolveProviderValue(runtime, starting.session, starting.registration)
    }
    const location = locateSingle(runtime, session.adapterHost, token, session)
    if (location.kind === 'local') {
        return resolveProviderValue(runtime, location.session, location.registration)
    }
    if (location.kind === 'foreign') {
        const values = dispatchRequest(runtime, session.adapterHost, token, false)
        const first = values[0]
        if (first !== undefined) {
            return await first
        }
    }
    throw new DocumentContextError(
        'UNKNOWN_SERVICE',
        `Cannot resolve token "${tokenName(token)}".`,
        { details: { token: tokenName(token) } },
    )
}

/**
 * Check that every declared dependency of a blueprint can be resolved.
 *
 * A wrong declaration is an error, not a wait: the session refuses to initialize.
 *
 * @param runtime - The application runtime.
 * @param session - The session that declares the dependencies.
 * @throws A `DocumentContextError` with code `UNKNOWN_SERVICE` when a declared token cannot be
 * resolved.
 */
export function assertUsesResolvable(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
): void {
    for (const registration of session.blueprint.providers) {
        for (const used of registration.uses) {
            if (!isUsedResolvable(runtime, session, used)) {
                throw new DocumentContextError(
                    'UNKNOWN_SERVICE',
                    `The declared dependency "${tokenName(used)}" cannot be resolved.`,
                    { details: { token: tokenName(used) } },
                )
            }
        }
    }
}

function isUsedResolvable(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
    token: TokenLike,
): boolean {
    const own = lastSingleRegistration(session, token)
    if (own !== undefined && singletonWinner(runtime, session, own) !== undefined) {
        return true
    }
    const scope = runtime.ports.host.scope
    for (const host of chainFrom(session.adapterHost)) {
        const declared = scope
            .declarationsOf(host)
            .find((entry) => entry.token === token && !entry.multi)
        const ancestor = runtime.sessions.get(host)
        if (ancestor !== undefined) {
            const ancestorSingle = lastSingleRegistration(ancestor, token)
            if (
                ancestorSingle !== undefined &&
                singletonWinner(runtime, ancestor, ancestorSingle) !== undefined
            ) {
                return true
            }
        }
        if (declared !== undefined && declared.owner !== runtime) {
            return true
        }
    }
    return false
}

/**
 * Detect a cycle in the `uses` graph of a blueprint.
 *
 * @param providers - The provider registrations.
 * @returns `true` when the graph contains a cycle.
 */
export function detectUsesCycle(providers: readonly ProviderRegistration[]): boolean {
    const byToken = new Map<TokenLike, ProviderRegistration>()
    for (const registration of providers) {
        byToken.set(registration.token, registration)
    }
    const visiting = new Set<TokenLike>()
    const visited = new Set<TokenLike>()
    const walk = (token: TokenLike): boolean => {
        if (visiting.has(token)) {
            return true
        }
        if (visited.has(token)) {
            return false
        }
        visiting.add(token)
        const registration = byToken.get(token)
        if (registration !== undefined) {
            for (const used of registration.uses) {
                if (byToken.has(used) && walk(used)) {
                    return true
                }
            }
        }
        visiting.delete(token)
        visited.add(token)
        return false
    }
    for (const token of byToken.keys()) {
        if (walk(token)) {
            return true
        }
    }
    return false
}

/**
 * Create the Context Protocol request handler of an active session.
 *
 * The handler answers `context-request` events for the public tokens this session provides. A
 * single-value request sets `detail.resolved` so that farther providers skip it — nearest-wins
 * never depends on `stopPropagation()`.
 *
 * @param runtime - The application runtime.
 * @param session - The session that owns the handler.
 * @returns The handler.
 */
export function createRequestHandler(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
): (detail: ContextRequestDetail) => void {
    return (detail: ContextRequestDetail): void => {
        const token = detail.context as TokenLike
        if (detail.multi === true) {
            const registrations = session.blueprint.providers.filter(
                (registration) =>
                    registration.token === token &&
                    registration.multi &&
                    isWinningSingleton(runtime, registration),
            )
            for (const registration of registrations) {
                detail.callback(resolveProviderValue(runtime, session, registration))
            }
            return
        }
        if (detail.resolved === true) {
            return
        }
        const registration = lastSingleRegistration(session, token)
        if (registration === undefined) {
            return
        }
        const owned = singletonWinner(runtime, session, registration)
        if (owned === undefined || owned.session !== session) {
            return
        }
        detail.callback(resolveProviderValue(runtime, session, owned.registration))
        detail.resolved = true
    }
}
