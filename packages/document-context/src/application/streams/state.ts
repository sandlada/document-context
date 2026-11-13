/**
 * The state stream.
 *
 * `state$` is a hot, multicast stream that backs the current snapshot: a new subscriber receives
 * the current snapshot synchronously, then every later push. Pushes happen synchronously inside the
 * `update` call and are de-duplicated by reference.
 */

import { Observable, Subject } from 'rxjs'
import { createOrderedSink } from './ordered-delivery'

export interface StateStream<S> {
    /** The public stream. */
    readonly observable: Observable<S>
    /** The current snapshot. */
    current(): S
    /**
     * Publish a new snapshot.
     *
     * @param next - The new snapshot. Snapshots equal by reference to the current one are ignored.
     */
    push(next: S): void
    /** Complete the stream. */
    complete(): void
}

class StateStreamImpl<S> implements StateStream<S> {
    private readonly subject = new Subject<S>()
    private readonly deliver: (value: S) => void
    private snapshot: S
    private closed = false

    constructor(initial: S) {
        this.snapshot = initial
        this.deliver = createOrderedSink((value) => {
            this.subject.next(value)
        })
        this.observable = new Observable<S>((subscriber) => {
            if (this.closed) {
                subscriber.complete()
                return undefined
            }
            const reentered: S[] = []
            const capture = this.subject.subscribe((value) => {
                reentered.push(value)
            })
            subscriber.next(this.snapshot)
            while (reentered.length > 0) {
                const value = reentered.shift() as S
                subscriber.next(value)
            }
            capture.unsubscribe()
            const subscription = this.subject.subscribe(subscriber)
            return () => subscription.unsubscribe()
        })
    }

    readonly observable: Observable<S>

    current(): S {
        return this.snapshot
    }

    push(next: S): void {
        if (this.closed || next === this.snapshot) {
            return
        }
        this.snapshot = next
        this.deliver(next)
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
 * Create a state stream.
 *
 * @param initial - The first snapshot.
 * @returns The stream handle.
 */
export function createStateStream<S>(initial: S): StateStream<S> {
    return new StateStreamImpl(initial)
}
