export interface DocumentContextErrorOptions {
    readonly code: string
    readonly message: string
    readonly details?: Record<string, unknown> | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Top-level abstract error base class for all `@sandlada/document-context` exceptions.
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

export interface CircularDependencyErrorOptions {
    readonly dependencyPath: readonly string[]
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Thrown when a synchronous or asynchronous circular dependency cycle is detected during injection.
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

export interface UnknownServiceErrorOptions {
    readonly token: string
    readonly targetElement?: (HTMLElement | string) | undefined
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Thrown when an inject() call requests an unprovided token in the DOM scope hierarchy.
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

export interface AsyncServiceNotReadyErrorOptions {
    readonly token: string
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Thrown when inject() is called synchronously on an asynchronous provider that has not resolved yet.
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

export interface DisposedSessionErrorOptions {
    readonly sessionKey?: string | undefined
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Thrown or logged when an operation is attempted on a disposed ISession instance.
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

export interface UnconnectedNodeErrorOptions {
    readonly token: string
    readonly targetNode?: (HTMLElement | Node) | undefined
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Thrown when inject() is called on an unconnected DOM element (node.isConnected === false).
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

export interface PropertySyncSecurityErrorOptions {
    readonly dangerousPath: string
    readonly targetNode?: (HTMLElement | string) | undefined
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Thrown when a bridge binding attempts prototype pollution or accesses forbidden XSS sinks.
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
 * Thrown or reported when an SSR / storage hydration mismatch occurs.
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

export interface InvalidStorageDataErrorOptions {
    readonly key: string
    readonly rawData: unknown
    readonly details?: Record<string, unknown> | undefined
    readonly message?: string | undefined
    readonly resolutionGuide?: string | undefined
    readonly cause?: unknown
}

/**
 * Thrown or reported when storage deserialization fails due to corrupted JSON payload.
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
