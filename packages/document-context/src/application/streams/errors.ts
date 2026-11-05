/**
 * The error stream.
 *
 * `errors$` carries non-fatal failures only. Errors raised while the session is still initializing
 * are buffered (at most 32) so that a subscriber attaching right after `mount` does not miss them.
 * The first subscriber drains the buffer; later subscribers only see new events.
 */

import { Observable, Subject } from 'rxjs'
import { DocumentContextError } from '../../domain/model/errors'

/** The maximum number of buffered initialization errors. */
export const ERROR_BUFFER_LIMIT = 32

export interface ErrorStream {
    /** The public stream. Never errors, only carries error events. */
    readonly observable: Observable<DocumentContextError>
    /**
     * Publish a non-fatal error.
     *
     * @param error - The error to publish.
     */
    push(error: DocumentContextError): void
    /** Complete the stream. */
    complete(): void
}

class ErrorStreamImpl implements ErrorStream {
    private readonly subject = new Subject<DocumentContextError>()
    private buffer: DocumentContextError[] = []
    private dropped = 0
    private drained = false
    private closed = false

    constructor() {
        this.observable = new Observable<DocumentContextError>((subscriber) => {
            if (this.closed) {
                subscriber.complete()
                return undefined
            }
            if (!this.drained) {
                this.drained = true
                const buffered = this.buffer
                const dropped = this.dropped
                this.buffer = []
                this.dropped = 0
                for (let index = 0; index < buffered.length; index += 1) {
                    const error = buffered[index] as DocumentContextError
                    const isLast = index === buffered.length - 1
                    subscriber.next(
                        isLast && dropped > 0
                            ? withDroppedCount(error, dropped)
                            : error,
                    )
                }
            }
            const subscription = this.subject.subscribe(subscriber)
            return () => subscription.unsubscribe()
        })
    }

    readonly observable: Observable<DocumentContextError>

    push(error: DocumentContextError): void {
        if (this.closed) {
            return
        }
        if (this.drained) {
            this.subject.next(error)
            return
        }
        this.buffer.push(error)
        while (this.buffer.length > ERROR_BUFFER_LIMIT) {
            this.buffer.shift()
            this.dropped += 1
        }
    }

    complete(): void {
        if (this.closed) {
            return
        }
        this.closed = true
        this.subject.complete()
    }
}

function withDroppedCount(error: DocumentContextError, dropped: number): DocumentContextError {
    if (error.details === undefined) {
        return new DocumentContextError(error.code, error.message, { dropped })
    }
    return new DocumentContextError(error.code, error.message, {
        details: error.details,
        dropped,
    })
}

/**
 * Create an error stream.
 *
 * @returns The stream handle.
 */
export function createErrorStream(): ErrorStream {
    return new ErrorStreamImpl()
}
