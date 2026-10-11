/**
 * SchedulerPort: the driven port owning every notion of time.
 *
 * This module declares types only and performs no runtime work. The domain
 * MUST NOT use time operators (`delay`, `debounceTime`, `timeout`), bare
 * `queueMicrotask`, or bare `setTimeout`: `timeoutMs`, TTLs, storage batch
 * windows, and retry batching all flow through this port so tests can run a
 * deterministic fake. It stays importable in a plain Node environment.
 */
export interface SchedulerPort {
    /**
     * Schedules a task on the microtask queue.
     *
     * @param task Callback to run on the next microtask drain.
     * @example
     * ```ts
     * import type { SchedulerPort } from './scheduler.js'
     *
     * const defer = (scheduler: SchedulerPort, task: () => void): void => {
     *     scheduler.microtask(task)
     * }
     * ```
     */
    microtask(task: () => void): void
    /**
     * Schedules a task after `ms` milliseconds.
     *
     * @param task Callback to run once the delay elapses.
     * @param ms Delay in milliseconds.
     * @returns Cancel function preventing the run; idempotent, and inert
     * once the task has already run.
     */
    timeout(task: () => void, ms: number): () => void
    /**
     * Schedules a task on the next animation frame. Where no
     * `requestAnimationFrame` exists the task MUST degrade to a microtask;
     * the scheduler contract suite guards this fallback.
     *
     * @param task Callback to run on the next frame (or microtask drain).
     * @returns Cancel function preventing the run; idempotent.
     */
    frame(task: () => void): () => void
}
