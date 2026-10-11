/**
 * Domain error taxonomy for document-context.
 *
 * This module is pure: no DOM access, no timers, no I/O. It runs in a plain
 * Node environment. Fatal versus non-fatal handling per code is defined by
 * the domain-model spec: fatal errors are thrown or rejected, non-fatal
 * errors (`SINGLETON_CONFLICT`, `INVALID_STORAGE_DATA`, `HOOK_ERROR`) are
 * pushed to the session `errors$` stream without interrupting cleanup.
 */

/**
 * Stable error codes shared by every layer.
 *
 * The set is closed: no layer may invent ad-hoc codes. Cancellation and
 * termination are not errors and never use these codes.
 */
export type DocumentContextErrorCode =
    | 'UNKNOWN_SERVICE'
    | 'CIRCULAR_DEPENDENCY'
    | 'DISPOSED_SESSION'
    | 'UNCONNECTED_NODE'
    | 'ASYNC_SERVICE_NOT_READY'
    | 'KEYED_SESSION_CONFLICT'
    | 'TOKEN_INVALID'
    | 'HOST_INVALID'
    | 'SINGLETON_CONFLICT'
    | 'INVALID_STORAGE_DATA'
    | 'HOOK_ERROR'
    | 'RESOLUTION_TIMEOUT'

/**
 * Default human-readable messages, one per code. Each message contains its
 * code so bare logs stay greppable.
 */
const DEFAULT_MESSAGES: Record<DocumentContextErrorCode, string> = {
    UNKNOWN_SERVICE: '[UNKNOWN_SERVICE] No single-value registration found for the token',
    CIRCULAR_DEPENDENCY: '[CIRCULAR_DEPENDENCY] Synchronous factory re-entered the same token',
    DISPOSED_SESSION: '[DISPOSED_SESSION] The session is already disposed',
    UNCONNECTED_NODE: '[UNCONNECTED_NODE] The mount host is not connected',
    ASYNC_SERVICE_NOT_READY: '[ASYNC_SERVICE_NOT_READY] A synchronous path touched an async service',
    KEYED_SESSION_CONFLICT: '[KEYED_SESSION_CONFLICT] Conflicting keyed session identity for the token',
    TOKEN_INVALID: '[TOKEN_INVALID] The token name violates the namespace rules',
    HOST_INVALID: '[HOST_INVALID] The host target is not a mountable host',
    SINGLETON_CONFLICT: '[SINGLETON_CONFLICT] A duplicate singleton registration was ignored',
    INVALID_STORAGE_DATA: '[INVALID_STORAGE_DATA] Stored data is corrupt, migrated badly, or version-blocked',
    HOOK_ERROR: '[HOOK_ERROR] A lifecycle hook or cleanup threw',
    RESOLUTION_TIMEOUT: '[RESOLUTION_TIMEOUT] Resolution exceeded the explicit timeout',
}

/**
 * Default resolution guides, one per code. Each guide names the corrective
 * action a caller should take.
 */
const DEFAULT_RESOLUTION_GUIDES: Record<DocumentContextErrorCode, string> = {
    UNKNOWN_SERVICE: 'Register a provider for this token, check the token spelling, or use injectAll for multi registrations.',
    CIRCULAR_DEPENDENCY: 'Break the synchronous factory cycle: resolve one dependency asynchronously or restructure the providers.',
    DISPOSED_SESSION: 'Stop using the session after dispose; mount a fresh session instead.',
    UNCONNECTED_NODE: 'Mount only hosts that are already connected to the document, for example inside connectedCallback.',
    ASYNC_SERVICE_NOT_READY: 'Use the async inject or mount APIs to await the service, or mark the factory eager.',
    KEYED_SESSION_CONFLICT: 'Use distinct tokens per identity, or resolve the conflict with an onConflict evict or reset policy.',
    TOKEN_INVALID: 'Use namespace:name form, charset [A-Za-z0-9._:/-], at most 256 chars; avoid blacklisted and reserved segments.',
    HOST_INVALID: 'Pass an Element, a HostPort, or a Session as the host target.',
    SINGLETON_CONFLICT: 'The first singleton registration wins; rename the token or remove the duplicate registration.',
    INVALID_STORAGE_DATA: 'Bump the storage version or clear the corrupt entry; the blueprint seed is used as a fallback.',
    HOOK_ERROR: 'Inspect details.error for the failing hook; note that onMount failures reject the mount itself.',
    RESOLUTION_TIMEOUT: 'Raise timeoutMs, or ensure a provider for the token is mounted in time.',
}

/**
 * Options accepted by the `DocumentContextError` constructor.
 */
export interface DocumentContextErrorOptions {
    /** Overrides the per-code default message. */
    readonly message?: string
    /** Overrides the per-code default resolution guide. */
    readonly resolutionGuide?: string
}

/**
 * Domain error carrying a stable code, structured details, and a resolution
 * guide. Pure value object: constructing it performs no I/O and reads no
 * global state.
 *
 * @param code Stable taxonomy code identifying the failure.
 * @param details Structured payload whose shape follows the code (for
 * example `{token, reason}` for `TOKEN_INVALID`).
 * @param options Optional message and resolution-guide overrides.
 * @returns The constructed error.
 */
export class DocumentContextError extends Error {
    /** Stable taxonomy code identifying the failure. */
    readonly code: DocumentContextErrorCode
    /** Structured payload; a frozen shallow copy of the input. */
    readonly details: Readonly<Record<string, unknown>>
    /** Corrective action for the caller; per-code default unless overridden. */
    readonly resolutionGuide: string

    constructor(
        code: DocumentContextErrorCode,
        details: Readonly<Record<string, unknown>> = {},
        options: DocumentContextErrorOptions = {},
    ) {
        super(options.message ?? DEFAULT_MESSAGES[code])
        this.name = 'DocumentContextError'
        this.code = code
        this.details = Object.freeze({ ...details })
        this.resolutionGuide = options.resolutionGuide ?? DEFAULT_RESOLUTION_GUIDES[code]
    }
}
