/**
 * Error taxonomy for `@sandlada/document-context`.
 *
 * This module is the single source of truth for failure identity. Every failure carries a stable
 * {@link ErrorCode} so callers can branch on `code` instead of on message text.
 */

export type ErrorCode =
    | 'UNCONNECTED_HOST'
    | 'HOST_INVALID'
    | 'TOKEN_INVALID'
    | 'KEYED_CONFLICT'
    | 'SINGLETON_CONFLICT'
    | 'UNKNOWN_SERVICE'
    | 'CIRCULAR_DEPENDENCY'
    | 'DISPOSED_SESSION'
    | 'HOOK_ERROR'
    | 'MOUNT_ABORTED'
    | 'INVALID_OPTIONS'
    | 'PENDING_LIMIT_EXCEEDED'
    | 'FOREIGN_SESSION'

export interface DocumentContextErrorOptions {
    readonly details?: Readonly<Record<string, unknown>>
    readonly dropped?: number
}

/**
 * The single error type produced by this library.
 *
 * Cancellation is **not** an error: unsubscribing from `inject$` never produces one of these.
 */
export class DocumentContextError extends Error {
    /** Stable machine-readable identity of the failure. */
    readonly code: ErrorCode
    /** Structured context about the failure. Never contains secrets. */
    readonly details: Readonly<Record<string, unknown>> | undefined
    /** Number of buffered entries that were dropped before this one (only used by `errors$`). */
    readonly dropped: number | undefined

    constructor(code: ErrorCode, message: string, options?: DocumentContextErrorOptions) {
        super(message)
        this.name = 'DocumentContextError'
        this.code = code
        this.details = options?.details
        this.dropped = options?.dropped
    }
}

/**
 * Narrow an unknown value to a {@link DocumentContextError}.
 *
 * @param value - The value to test.
 * @returns `true` when `value` is a `DocumentContextError`.
 */
export function isDocumentContextError(value: unknown): value is DocumentContextError {
    return value instanceof DocumentContextError
}

/**
 * Wrap an arbitrary thrown value into a {@link DocumentContextError} without losing the original.
 *
 * @param value - The caught value.
 * @param code - The code to use when `value` is not already a `DocumentContextError`.
 * @param message - The message used when `value` is not an `Error`.
 * @returns A `DocumentContextError` carrying the original value in `details.cause`.
 */
export function toDocumentContextError(
    value: unknown,
    code: ErrorCode,
    message: string,
): DocumentContextError {
    if (isDocumentContextError(value)) {
        return value
    }
    const cause = value instanceof Error ? value : new Error(message)
    return new DocumentContextError(code, cause.message, { details: { cause } })
}
