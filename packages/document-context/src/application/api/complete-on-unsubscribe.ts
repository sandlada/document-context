/**
 * Make an RxJS subscriber report `complete` when the consumer unsubscribes.
 *
 * `Subscriber.unsubscribe` marks the subscriber stopped before teardown, so calling
 * `complete()` from teardown never reaches the observer. The spec for `inject$` and
 * `injectAll$` says unsubscribing completes the stream without an error.
 *
 * @param subscriber - The subscriber returned to the consumer.
 * @returns Guards the producer uses so a later settlement does not notify twice.
 */
export function completeOnUnsubscribe(subscriber: {
    closed: boolean
    complete: () => void
    unsubscribe: () => void
}): { isFinished: () => boolean; markFinished: () => void } {
    let finished = false
    const originalUnsubscribe = subscriber.unsubscribe.bind(subscriber)
    subscriber.unsubscribe = () => {
        if (!finished && !subscriber.closed) {
            finished = true
            subscriber.complete()
            return
        }
        originalUnsubscribe()
    }
    return {
        isFinished: () => finished,
        markFinished: () => {
            finished = true
        },
    }
}
