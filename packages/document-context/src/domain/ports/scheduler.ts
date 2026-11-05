/**
 * Scheduler port.
 *
 * Every time-dependent behaviour of the library goes through this port: the microtask re-attachment
 * check after a disconnect, the keyed suspension TTL, the batched wake-up of pending injections and
 * the observer re-check. The verbs themselves never call `setTimeout` or `queueMicrotask` directly.
 */
export interface SchedulerPort {
    /**
     * Schedule a microtask.
     *
     * @param task - The task to run.
     * @returns A function that cancels the task.
     */
    microtask(task: () => void): () => void
    /**
     * Schedule a timeout.
     *
     * @param task - The task to run.
     * @param delayMs - The delay in milliseconds.
     * @returns A function that cancels the task.
     */
    timeout(task: () => void, delayMs: number): () => void
    /**
     * Schedule a frame.
     *
     * @param task - The task to run.
     * @returns A function that cancels the task.
     */
    frame(task: () => void): () => void
}
