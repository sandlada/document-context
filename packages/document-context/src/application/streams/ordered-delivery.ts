/**
 * Deliver values through a synchronous fan-out without reentering it.
 *
 * A callback that emits again is queued until the current delivery finishes, so every subscriber
 * observes the values in the same order.
 */

/**
 * Create a sink that forwards values to `emit` in call order.
 *
 * @param emit - The synchronous fan-out.
 * @returns The ordered sink.
 */
export function createOrderedSink<T>(emit: (value: T) => void): (value: T) => void {
    const pending: T[] = []
    let delivering = false
    return (value: T): void => {
        pending.push(value)
        if (delivering) {
            return
        }
        delivering = true
        try {
            while (pending.length > 0) {
                const next = pending.shift() as T
                emit(next)
            }
        } finally {
            delivering = false
        }
    }
}
