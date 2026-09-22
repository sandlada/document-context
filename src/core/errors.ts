/**
 * Options bag for constructing a {@link DocumentContextError}.
 *
 * @property code - Stable machine-readable code (for example
 * `'UNKNOWN_SERVICE'`). Surfaced as `error.code` and in `toString()`.
 * @property message - Human-readable message.
 * @property details - Structured diagnostic payload, always defaulted to `{}`.
 * @property resolutionGuide - Actionable fix hint appended to `toString()`.
 * @property cause - Underlying cause, forwarded to `Error` options.
 */
export interface DocumentContextErrorOptions {
    readonly code: string
    readonly message: string
    readonly details?: Record<string, unknown> | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Abstract base class for every `@sandlada/document-context` exception.
 *
 * Carries a stable `code`, a structured `details` bag, and an optional
 * `resolutionGuide` alongside the standard `Error` message, name, and cause.
 * All errors pushed to the session error stream (`readErrorStream`) are
 * instances of this class. Never thrown directly; catch one of the concrete
 * subclasses instead.
 *
 * @param options - See {@link DocumentContextErrorOptions}.
 * @returns A `DocumentContextError` instance whose `name` equals the concrete
 * subclass name.
 *
 * @example
 * ```ts
 * import { readErrorStream } from '@sandlada/document-context'
 *
 * readErrorStream(session).subscribe((err) => {
 *     console.error(err.toString(), err.code, err.details)
 * })
 * ```
 */
export class DocumentContextError extends Error {
    readonly code: string
    readonly details: Record<string, unknown>
    readonly resolutionGuide?: string | undefined

    constructor(options: DocumentContextErrorOptions) {
        super(options.message, { cause: options.cause })
        this.name = new.target.name
        this.code = options.code
        this.details = options.details ?? {}
        this.resolutionGuide = options.resolutionGuide
        Object.setPrototypeOf(this, new.target.prototype)
    }

    override toString(): string {
        let result = `[${this.code}] ${this.name}: ${this.message}`
        if (this.resolutionGuide) {
            result += `\nResolution Guide: ${this.resolutionGuide}`
        }
        return result
    }
}

/**
 * Options bag for {@link CircularDependencyError}.
 *
 * @property dependencyPath - Ordered token-name cycle, for example
 * `['a', 'b', 'a']`.
 * @property details - Extra diagnostics merged with `{ dependencyPath }`.
 * @property message - Custom message override. Defaults to
 * `` `Circular dependency detected: ${path.join(' -> ')}` ``.
 * @property resolutionGuide - Fix hint override.
 * @property cause - Underlying cause.
 */
export interface CircularDependencyErrorOptions {
    readonly dependencyPath: readonly string[]
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Thrown when a dependency cycle is detected during service resolution.
 *
 * Both the synchronous (`inject`) and asynchronous (`injectAsync`) pipelines
 * maintain a resolution stack; re-entering a token already on the stack throws
 * this error with the full `dependencyPath`. Break the cycle with lazy
 * resolution (inject inside a method instead of the factory top level),
 * by extracting shared logic into a third service, or via event decoupling.
 *
 * The constructor accepts either a bare path array or a full options bag, plus
 * an optional positional `resolutionGuide` shorthand.
 *
 * @param dependencyPathOrOptions - Either the cycle path array or a
 * {@link CircularDependencyErrorOptions} bag.
 * @param resolutionGuide - Positional guide override, used only with the array
 * form.
 * @returns A `CircularDependencyError` with `code === 'CIRCULAR_DEPENDENCY'`.
 *
 * @example
 * ```ts
 * import { CircularDependencyError } from '@sandlada/document-context'
 *
 * throw new CircularDependencyError(['auth', 'router', 'auth'])
 * throw new CircularDependencyError({
 *     dependencyPath: ['a', 'b', 'a'],
 *     details: { token: 'a' }
 * })
 * ```
 */
export class CircularDependencyError extends DocumentContextError {
    readonly dependencyPath: readonly string[]

    constructor(
        dependencyPathOrOptions: readonly string[] | CircularDependencyErrorOptions,
        resolutionGuide?: string
    ) {
        const isOptions = !Array.isArray(dependencyPathOrOptions) && typeof dependencyPathOrOptions === 'object'
        const dependencyPath = isOptions
            ? (dependencyPathOrOptions as CircularDependencyErrorOptions).dependencyPath
            : (dependencyPathOrOptions as readonly string[])
        const customMessage = isOptions ? (dependencyPathOrOptions as CircularDependencyErrorOptions).message : undefined
        const guide = (isOptions ? (dependencyPathOrOptions as CircularDependencyErrorOptions).resolutionGuide : resolutionGuide) ??
            'Break the dependency cycle by using lazy service resolution, refactoring shared logic into a separate service, or employing event-based decoupling.'
        const cause = isOptions ? (dependencyPathOrOptions as CircularDependencyErrorOptions).cause : undefined
        const extraDetails = isOptions ? (dependencyPathOrOptions as CircularDependencyErrorOptions).details : undefined

        const pathStr = dependencyPath.join(' -> ')
        const message = customMessage ?? `Circular dependency detected: ${pathStr}`

        super({
            code: 'CIRCULAR_DEPENDENCY',
            message,
            details: { dependencyPath, ...(extraDetails ?? {}) },
            resolutionGuide: guide,
            cause
        })
        this.dependencyPath = dependencyPath
    }
}

/**
 * Options bag for {@link UnknownServiceError}.
 *
 * @property token - Requested token name.
 * @property targetElement - Host element or tag-name string where resolution
 * was attempted. Used only for diagnostics.
 * @property details - Extra diagnostics merged with `{ token }`.
 * @property message - Custom message override.
 * @property resolutionGuide - Fix hint override.
 * @property cause - Underlying cause.
 */
export interface UnknownServiceErrorOptions {
    readonly token: string
    readonly targetElement?: (HTMLElement | string) | undefined
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Thrown when `inject()` finds no provider for a token in the DOM scope chain.
 *
 * Resolution walks the `context-request` event path up to the document root
 * and then consults the global singleton registry. If every step misses, this
 * error is thrown. Register the token with `withProvider()` /
 * `withAsyncProvider()` on an ancestor blueprint, or seed it via
 * `setGlobalSingleton()`.
 *
 * The constructor accepts either `(token, targetElement?)` positionally or a
 * full options bag.
 *
 * @param tokenOrOptions - Token name string or
 * {@link UnknownServiceErrorOptions} bag.
 * @param targetElement - Host element, used only with the string form.
 * @returns An `UnknownServiceError` with `code === 'UNKNOWN_SERVICE'`.
 *
 * @example
 * ```ts
 * import { inject, withProvider, createContext, pipe, mount } from '@sandlada/document-context'
 *
 * try {
 *     inject('auth-service')(document.getElementById('login')!)
 * } catch (err) {
 *     console.error(String(err))
 * }
 * ```
 */
export class UnknownServiceError extends DocumentContextError {
    readonly token: string
    readonly targetElement?: (HTMLElement | string) | undefined

    constructor(
        tokenOrOptions: string | UnknownServiceErrorOptions,
        targetElement?: HTMLElement | string
    ) {
        const isOptions = typeof tokenOrOptions === 'object' && tokenOrOptions !== null
        const token = isOptions
            ? (tokenOrOptions as UnknownServiceErrorOptions).token
            : (tokenOrOptions as string)
        const target = isOptions
            ? (tokenOrOptions as UnknownServiceErrorOptions).targetElement
            : targetElement
        const customMessage = isOptions ? (tokenOrOptions as UnknownServiceErrorOptions).message : undefined
        const guide = (isOptions ? (tokenOrOptions as UnknownServiceErrorOptions).resolutionGuide : undefined) ??
            `Ensure that a provider for '${token}' is registered via withProvider() or withAsyncProvider() in an ancestor blueprint or mounted container, or that '${token}' is available globally.`
        const cause = isOptions ? (tokenOrOptions as UnknownServiceErrorOptions).cause : undefined
        const extraDetails = isOptions ? (tokenOrOptions as UnknownServiceErrorOptions).details : undefined

        const targetDesc = typeof target === 'string'
            ? target
            : target?.tagName?.toLowerCase() ?? 'unknown element'
        const message = customMessage ?? `Unknown service token '${token}' requested on target <${targetDesc}>.`

        super({
            code: 'UNKNOWN_SERVICE',
            message,
            details: {
                token,
                ...(target !== undefined ? { targetElement: target } : {}),
                ...(extraDetails ?? {})
            },
            resolutionGuide: guide,
            cause
        })
        this.token = token
        this.targetElement = target
    }
}

/**
 * Options bag for {@link AsyncServiceNotReadyError}.
 *
 * @property token - Requested async token name.
 * @property details - Extra diagnostics merged with `{ token }`.
 * @property message - Custom message override.
 * @property resolutionGuide - Fix hint override.
 * @property cause - Underlying cause.
 */
export interface AsyncServiceNotReadyErrorOptions {
    readonly token: string
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Thrown when synchronous `inject()` targets an async provider that has not
 * resolved yet.
 *
 * Async registrations (`withAsyncProvider`) never resolve synchronously. Use
 * `injectAsync(token)(target)` and `await` the result, or `await
 * mountAsync()(element)` first for eager singletons.
 *
 * The constructor accepts either a token string or a full options bag.
 *
 * @param tokenOrOptions - Token name or
 * {@link AsyncServiceNotReadyErrorOptions} bag.
 * @returns An `AsyncServiceNotReadyError` with
 * `code === 'ASYNC_SERVICE_NOT_READY'`.
 *
 * @example
 * ```ts
 * import { injectAsync } from '@sandlada/document-context'
 *
 * const svc = await injectAsync('remote-config')(document.getElementById('app')!)
 * ```
 */
export class AsyncServiceNotReadyError extends DocumentContextError {
    readonly token: string

    constructor(tokenOrOptions: string | AsyncServiceNotReadyErrorOptions) {
        const isOptions = typeof tokenOrOptions === 'object' && tokenOrOptions !== null
        const token = isOptions
            ? (tokenOrOptions as AsyncServiceNotReadyErrorOptions).token
            : (tokenOrOptions as string)
        const customMessage = isOptions ? (tokenOrOptions as AsyncServiceNotReadyErrorOptions).message : undefined
        const guide = (isOptions ? (tokenOrOptions as AsyncServiceNotReadyErrorOptions).resolutionGuide : undefined) ??
            `Use injectAsync('${token}') to asynchronously resolve and await the service instance, or ensure mountAsync() has finished resolving eager async providers.`
        const cause = isOptions ? (tokenOrOptions as AsyncServiceNotReadyErrorOptions).cause : undefined
        const extraDetails = isOptions ? (tokenOrOptions as AsyncServiceNotReadyErrorOptions).details : undefined

        const message = customMessage ?? `Async service '${token}' is not ready yet for synchronous inject().`

        super({
            code: 'ASYNC_SERVICE_NOT_READY',
            message,
            details: { token, ...(extraDetails ?? {}) },
            resolutionGuide: guide,
            cause
        })
        this.token = token
    }
}

/**
 * Options bag for {@link DisposedSessionError}.
 *
 * @property sessionKey - Value of `data-context-key` when known. Used only
 * for diagnostics.
 * @property details - Extra diagnostics.
 * @property message - Custom message override.
 * @property resolutionGuide - Fix hint override.
 * @property cause - Underlying cause.
 */
export interface DisposedSessionErrorOptions {
    readonly sessionKey?: string | undefined
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Reported when an operation targets a disposed `ISession`.
 *
 * Note the runtime contract: `update()` / `subscribe()` on a disposed session
 * silently no-op (returning `false` / an empty unsubscribe) rather than
 * throwing, so dangling async closures cannot crash the page. This error class
 * exists for explicit diagnostic paths and custom guards that choose to
 * surface disposal loudly.
 *
 * The constructor accepts a session-key string, an options bag, or nothing.
 *
 * @param sessionKeyOrOptions - Session key string or
 * {@link DisposedSessionErrorOptions} bag. Optional.
 * @returns A `DisposedSessionError` with `code === 'DISPOSED_SESSION'`.
 *
 * @example
 * ```ts
 * import { update } from '@sandlada/document-context'
 *
 * const ok = update({ count: 1 })(session)
 * if (!ok) {
 *     console.warn('session already disposed, update skipped')
 * }
 * ```
 */
export class DisposedSessionError extends DocumentContextError {
    readonly sessionKey?: string | undefined

    constructor(sessionKeyOrOptions?: string | DisposedSessionErrorOptions) {
        const isOptions = typeof sessionKeyOrOptions === 'object' && sessionKeyOrOptions !== null
        const sessionKey = isOptions
            ? (sessionKeyOrOptions as DisposedSessionErrorOptions).sessionKey
            : (sessionKeyOrOptions as string | undefined)
        const customMessage = isOptions ? (sessionKeyOrOptions as DisposedSessionErrorOptions).message : undefined
        const guide = (isOptions ? (sessionKeyOrOptions as DisposedSessionErrorOptions).resolutionGuide : undefined) ??
            'Do not perform state updates or inject dependencies on a disposed session. Check session.isDisposed or avoid holding dangling references to unmounted sessions.'
        const cause = isOptions ? (sessionKeyOrOptions as DisposedSessionErrorOptions).cause : undefined
        const extraDetails = isOptions ? (sessionKeyOrOptions as DisposedSessionErrorOptions).details : undefined

        const keyDesc = sessionKey ? ` (key: '${sessionKey}')` : ''
        const message = customMessage ?? `Attempted operation on a disposed session${keyDesc}.`

        super({
            code: 'DISPOSED_SESSION',
            message,
            details: {
                ...(sessionKey !== undefined ? { sessionKey } : {}),
                ...(extraDetails ?? {})
            },
            resolutionGuide: guide,
            cause
        })
        this.sessionKey = sessionKey
    }
}

/**
 * Options bag for {@link UnconnectedNodeError}.
 *
 * @property token - Requested token name.
 * @property targetNode - Detached DOM node. Used only for diagnostics.
 * @property details - Extra diagnostics.
 * @property message - Custom message override.
 * @property resolutionGuide - Fix hint override.
 * @property cause - Underlying cause.
 */
export interface UnconnectedNodeErrorOptions {
    readonly token: string
    readonly targetNode?: (HTMLElement | Node) | undefined
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Thrown when `inject()` is called on a detached DOM node.
 *
 * Scope resolution depends on `context-request` event bubbling through
 * connected ancestors, so `node.isConnected` must be `true`. The single
 * exception is a token already present in the global singleton registry, which
 * resolves without DOM traversal. Otherwise, defer injection to
 * `connectedCallback()` or to after `parent.appendChild(node)`.
 *
 * The constructor accepts either `(token, targetNode?)` positionally or a
 * full options bag.
 *
 * @param tokenOrOptions - Token name or {@link UnconnectedNodeErrorOptions}.
 * @param targetNode - Detached node, used only with the string form.
 * @returns An `UnconnectedNodeError` with `code === 'UNCONNECTED_NODE'`.
 *
 * @example
 * ```ts
 * import { inject } from '@sandlada/document-context'
 *
 * class MyEl extends HTMLElement {
 *     connectedCallback() {
 *         const svc = inject('logger')(this)
 *     }
 * }
 * ```
 */
export class UnconnectedNodeError extends DocumentContextError {
    readonly token: string
    readonly targetNode?: (HTMLElement | Node) | undefined

    constructor(
        tokenOrOptions: string | UnconnectedNodeErrorOptions,
        targetNode?: HTMLElement | Node
    ) {
        const isOptions = typeof tokenOrOptions === 'object' && tokenOrOptions !== null
        const token = isOptions
            ? (tokenOrOptions as UnconnectedNodeErrorOptions).token
            : (tokenOrOptions as string)
        const target = isOptions
            ? (tokenOrOptions as UnconnectedNodeErrorOptions).targetNode
            : targetNode
        const customMessage = isOptions ? (tokenOrOptions as UnconnectedNodeErrorOptions).message : undefined
        const guide = (isOptions ? (tokenOrOptions as UnconnectedNodeErrorOptions).resolutionGuide : undefined) ??
            'Ensure the target DOM element is connected to the document (node.isConnected === true) before invoking inject(), e.g. inside connectedCallback() or after appending the node to the DOM.'
        const cause = isOptions ? (tokenOrOptions as UnconnectedNodeErrorOptions).cause : undefined
        const extraDetails = isOptions ? (tokenOrOptions as UnconnectedNodeErrorOptions).details : undefined

        const nodeDesc = target instanceof Element
            ? `<${target.tagName.toLowerCase()}>`
            : 'unconnected node'
        const message = customMessage ?? `Cannot inject service '${token}' on an unconnected DOM node ${nodeDesc}.`

        super({
            code: 'UNCONNECTED_NODE',
            message,
            details: {
                token,
                ...(target !== undefined ? { targetNode: target } : {}),
                ...(extraDetails ?? {})
            },
            resolutionGuide: guide,
            cause
        })
        this.token = token
        this.targetNode = target
    }
}

/**
 * Options bag for {@link PropertySyncSecurityError}.
 *
 * @property dangerousPath - Rejected bridge path as written in the blueprint.
 * @property targetNode - Host element or tag-name string for diagnostics.
 * @property details - Extra diagnostics (includes `blockedSegment` or
 * `blockedSink`).
 * @property message - Custom message override.
 * @property resolutionGuide - Fix hint override.
 * @property cause - Underlying cause.
 */
export interface PropertySyncSecurityErrorOptions {
    readonly dangerousPath: string
    readonly targetNode?: (HTMLElement | string) | undefined
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Thrown when a bridge path attempts prototype pollution or targets an XSS sink.
 *
 * Matching is case-insensitive per dot-segment. Blocked tokens are
 * `__proto__`, `prototype`, `constructor`; blocked sinks are `innerHTML`,
 * `outerHTML`, `insertAdjacentHTML`, `srcdoc`, `script`, and `eval`. Thrown
 * eagerly by `validatePropertyPath()` from both `readDomProperty()` and
 * `writeDomProperty()`, so a bad mapping fails at mount rather than silently
 * writing somewhere dangerous.
 *
 * The constructor accepts either `(dangerousPath, targetNode?)` positionally
 * or a full options bag.
 *
 * @param dangerousPathOrOptions - Rejected path or
 * {@link PropertySyncSecurityErrorOptions} bag.
 * @param targetNode - Host element, used only with the string form.
 * @returns A `PropertySyncSecurityError` with
 * `code === 'PROPERTY_SYNC_SECURITY_VIOLATION'`.
 *
 * @example
 * ```ts
 * import { withBridge } from '@sandlada/document-context'
 *
 * // Throws at mount: 'innerHTML' is a forbidden sink.
 * const bad = pipe(base, withBridge({ properties: { html: 'innerHTML' } }))
 * ```
 */
export class PropertySyncSecurityError extends DocumentContextError {
    readonly dangerousPath: string
    readonly targetNode?: (HTMLElement | string) | undefined

    constructor(
        dangerousPathOrOptions: string | PropertySyncSecurityErrorOptions,
        targetNode?: HTMLElement | string
    ) {
        const isOptions = typeof dangerousPathOrOptions === 'object' && dangerousPathOrOptions !== null
        const dangerousPath = isOptions
            ? (dangerousPathOrOptions as PropertySyncSecurityErrorOptions).dangerousPath
            : (dangerousPathOrOptions as string)
        const target = isOptions
            ? (dangerousPathOrOptions as PropertySyncSecurityErrorOptions).targetNode
            : targetNode
        const customMessage = isOptions ? (dangerousPathOrOptions as PropertySyncSecurityErrorOptions).message : undefined
        const guide = (isOptions ? (dangerousPathOrOptions as PropertySyncSecurityErrorOptions).resolutionGuide : undefined) ??
            'Bridge property paths must not contain prototype pollution vectors (__proto__, prototype, constructor) or forbidden XSS sinks (innerHTML, outerHTML, insertAdjacentHTML, srcdoc, script).'
        const cause = isOptions ? (dangerousPathOrOptions as PropertySyncSecurityErrorOptions).cause : undefined
        const extraDetails = isOptions ? (dangerousPathOrOptions as PropertySyncSecurityErrorOptions).details : undefined

        const targetDesc = typeof target === 'string'
            ? target
            : target?.tagName?.toLowerCase() ?? 'node'
        const message = customMessage ?? `Blocked dangerous property sync path '${dangerousPath}' on <${targetDesc}>.`

        super({
            code: 'PROPERTY_SYNC_SECURITY_VIOLATION',
            message,
            details: {
                dangerousPath,
                ...(target !== undefined ? { targetNode: target } : {}),
                ...(extraDetails ?? {})
            },
            resolutionGuide: guide,
            cause
        })
        this.dangerousPath = dangerousPath
        this.targetNode = target
    }
}

/**
 * Options bag for {@link HydrationMismatchError}.
 *
 * @property propertyKey - State key whose sources disagreed.
 * @property expectedValue - Value from the reference source (per strategy).
 * @property actualValue - Value actually applied after the merge.
 * @property details - Extra diagnostics.
 * @property message - Custom message override.
 * @property resolutionGuide - Fix hint override.
 * @property cause - Underlying cause.
 */
export interface HydrationMismatchErrorOptions {
    readonly propertyKey: string
    readonly expectedValue: unknown
    readonly actualValue: unknown
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Reported when server-rendered DOM, persisted storage, and blueprint seeds
 * disagree on a property during hydration.
 *
 * This is a diagnostic carrier rather than a hard failure: the configured
 * `hydrationStrategy` (`storageFirst` by default) deterministically picks the
 * winner, and this error shape documents the loser for logging or dev
 * overlays. Check the strategy and verify SSR HTML matches client seeds.
 *
 * The constructor accepts either `(propertyKey, expectedValue, actualValue?)`
 * positionally or a full options bag.
 *
 * @param propertyKeyOrOptions - State key or
 * {@link HydrationMismatchErrorOptions} bag.
 * @param expectedValue - Reference value, used only with the string form.
 * @param actualValue - Applied value, used only with the string form.
 * @returns A `HydrationMismatchError` with `code === 'HYDRATION_MISMATCH'`.
 *
 * @example
 * ```ts
 * import { HydrationMismatchError } from '@sandlada/document-context'
 *
 * throw new HydrationMismatchError({
 *     propertyKey: 'theme',
 *     expectedValue: 'dark',
 *     actualValue: 'light'
 * })
 * ```
 */
export class HydrationMismatchError extends DocumentContextError {
    readonly propertyKey: string
    readonly expectedValue: unknown
    readonly actualValue: unknown

    constructor(
        propertyKeyOrOptions: string | HydrationMismatchErrorOptions,
        expectedValue?: unknown,
        actualValue?: unknown
    ) {
        const isOptions = typeof propertyKeyOrOptions === 'object' && propertyKeyOrOptions !== null
        const propertyKey = isOptions
            ? (propertyKeyOrOptions as HydrationMismatchErrorOptions).propertyKey
            : (propertyKeyOrOptions as string)
        const expVal = isOptions
            ? (propertyKeyOrOptions as HydrationMismatchErrorOptions).expectedValue
            : expectedValue
        const actVal = isOptions
            ? (propertyKeyOrOptions as HydrationMismatchErrorOptions).actualValue
            : actualValue
        const customMessage = isOptions ? (propertyKeyOrOptions as HydrationMismatchErrorOptions).message : undefined
        const guide = (isOptions ? (propertyKeyOrOptions as HydrationMismatchErrorOptions).resolutionGuide : undefined) ??
            'Check hydrationStrategy configuration (e.g. domFirst vs storageFirst) and verify server-rendered HTML matches initial client state.'
        const cause = isOptions ? (propertyKeyOrOptions as HydrationMismatchErrorOptions).cause : undefined
        const extraDetails = isOptions ? (propertyKeyOrOptions as HydrationMismatchErrorOptions).details : undefined

        const message = customMessage ?? `Hydration mismatch on property '${propertyKey}'. Expected: ${JSON.stringify(expVal)}, Actual: ${JSON.stringify(actVal)}.`

        super({
            code: 'HYDRATION_MISMATCH',
            message,
            details: {
                propertyKey,
                expectedValue: expVal,
                actualValue: actVal,
                ...(extraDetails ?? {})
            },
            resolutionGuide: guide,
            cause
        })
        this.propertyKey = propertyKey
        this.expectedValue = expVal
        this.actualValue = actVal
    }
}

/**
 * Options bag for {@link InvalidStorageDataError}.
 *
 * @property key - Storage key that failed to deserialize.
 * @property rawData - Raw payload (or the caught exception when deserialization
 * itself threw). Kept as-is for inspection; may be `null`.
 * @property details - Extra diagnostics (usually `{ error: String(err) }`).
 * @property message - Custom message override.
 * @property resolutionGuide - Fix hint override.
 * @property cause - Underlying cause.
 */
export interface InvalidStorageDataErrorOptions {
    readonly key: string
    readonly rawData: unknown
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Reported when storage deserialization fails or persisted JSON is corrupt.
 *
 * The storage pipeline never lets a bad payload crash mounting: synchronous
 * read failures, async adapter rejections, `BroadcastChannel` message parse
 * failures, and `storage`-event parse failures are all routed to the session
 * error stream (`readErrorStream`) as this error, and hydration falls back to
 * DOM/blueprint sources. Supply a `migrate` function in `withStorage` to
 * recover old schemas instead of dropping them.
 *
 * The constructor accepts either `(key, rawData?)` positionally or a full
 * options bag.
 *
 * @param keyOrOptions - Storage key or {@link InvalidStorageDataErrorOptions}.
 * @param rawData - Raw payload, used only with the string form.
 * @returns An `InvalidStorageDataError` with `code === 'INVALID_STORAGE_DATA'`.
 *
 * @example
 * ```ts
 * import { readErrorStream } from '@sandlada/document-context'
 *
 * readErrorStream(session).subscribe((err) => {
 *     if (err.code === 'INVALID_STORAGE_DATA') {
 *         console.warn('dropping corrupt payload for', err.details)
 *     }
 * })
 * ```
 */
export class InvalidStorageDataError extends DocumentContextError {
    readonly key: string
    readonly rawData: unknown

    constructor(
        keyOrOptions: string | InvalidStorageDataErrorOptions,
        rawData?: unknown
    ) {
        const isOptions = typeof keyOrOptions === 'object' && keyOrOptions !== null
        const key = isOptions
            ? (keyOrOptions as InvalidStorageDataErrorOptions).key
            : (keyOrOptions as string)
        const raw = isOptions
            ? (keyOrOptions as InvalidStorageDataErrorOptions).rawData
            : rawData
        const customMessage = isOptions ? (keyOrOptions as InvalidStorageDataErrorOptions).message : undefined
        const guide = (isOptions ? (keyOrOptions as InvalidStorageDataErrorOptions).resolutionGuide : undefined) ??
            'Provide a valid JSON payload in storage or implement a migrate function to handle schema migrations safely.'
        const cause = isOptions ? (keyOrOptions as InvalidStorageDataErrorOptions).cause : undefined
        const extraDetails = isOptions ? (keyOrOptions as InvalidStorageDataErrorOptions).details : undefined

        const message = customMessage ?? `Corrupted or invalid storage data encountered for key '${key}'.`

        super({
            code: 'INVALID_STORAGE_DATA',
            message,
            details: {
                key,
                rawData: raw,
                ...(extraDetails ?? {})
            },
            resolutionGuide: guide,
            cause
        })
        this.key = key
        this.rawData = raw
    }
}
