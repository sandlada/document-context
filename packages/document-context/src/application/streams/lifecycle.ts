/**
 * The lifecycle stream.
 *
 * `lifecycle$` is hot and backs the **current status**: a new subscriber immediately receives the
 * event that represents the current status (`active` / `suspended` / `disposed`). `starting` has no
 * corresponding event. History is never replayed beyond that single backing event.
 */

import { Observable, Subject } from 'rxjs'
import type { LifecycleEvent } from '../../domain/model/lifecycle'
import { createOrderedSink } from './ordered-delivery'

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
    private readonly deliver: (event: LifecycleEvent) => void
    private backed: LifecycleEvent | null = null
    private closed = false
    private finished = false
    private depth = 0

    constructor() {
        this.deliver = createOrderedSink((event) => {
            this.depth += 1
            try {
                this.subject.next(event)
            } finally {
                this.depth -= 1
            }
        }, () => {
            this.finish()
        })
        this.observable = new Observable<LifecycleEvent>((subscriber) => {
            if (this.closed) {
                subscriber.complete()
                return undefined
            }
            if (this.backed !== null) {
                const reentered: LifecycleEvent[] = []
                const capture = this.subject.subscribe((event) => {
                    reentered.push(event)
                })
                subscriber.next(this.backed)
                while (reentered.length > 0) {
                    const event = reentered.shift() as LifecycleEvent
                    subscriber.next(event)
                }
                capture.unsubscribe()
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
        this.deliver(event)
    }

    complete(): void {
        if (this.closed) {
            return
        }
        this.closed = true
        if (this.depth === 0) {
            this.finish()
        }
    }

    /** Complete after the current fan-out has reached every subscriber. */
    private finish(): void {
        if (!this.closed || this.finished || this.depth !== 0) {
            return
        }
        this.finished = true
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
