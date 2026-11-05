/**
 * The lifecycle stream.
 *
 * `lifecycle$` is hot and backs the **current status**: a new subscriber immediately receives the
 * event that represents the current status (`active` / `suspended` / `disposed`). `starting` has no
 * corresponding event. History is never replayed beyond that single backing event.
 */

import { Observable, Subject } from 'rxjs'
import type { LifecycleEvent } from '../../domain/model/lifecycle'

export interface LifecycleStream {
    /** The public stream. */
    readonly observable: Observable<LifecycleEvent>
    /**
     * Apply a status transition.
     *
     * @param backed - The event representing the new status, or `null` when the status has no event.
     * @param event - The incremental event published to existing subscribers.
     */
    transition(backed: LifecycleEvent | null, event: LifecycleEvent): void
    /** Complete the stream. */
    complete(): void
}

class LifecycleStreamImpl implements LifecycleStream {
    private readonly subject = new Subject<LifecycleEvent>()
    private backed: LifecycleEvent | null = null
    private closed = false

    constructor() {
        this.observable = new Observable<LifecycleEvent>((subscriber) => {
            if (this.closed) {
                subscriber.complete()
                return undefined
            }
            if (this.backed !== null) {
                subscriber.next(this.backed)
            }
            const subscription = this.subject.subscribe(subscriber)
            return () => subscription.unsubscribe()
        })
    }

    readonly observable: Observable<LifecycleEvent>

    transition(backed: LifecycleEvent | null, event: LifecycleEvent): void {
        if (this.closed) {
            return
        }
        this.backed = backed
        this.subject.next(event)
    }

    complete(): void {
        if (this.closed) {
            return
        }
        this.closed = true
        this.subject.complete()
    }
}

/**
 * Create a lifecycle stream.
 *
 * @returns The stream handle.
 */
export function createLifecycleStream(): LifecycleStream {
    return new LifecycleStreamImpl()
}
