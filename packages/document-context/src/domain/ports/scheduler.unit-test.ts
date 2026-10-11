import { describe, expect, it } from 'vitest'
import type { SchedulerPort } from './scheduler.js'

/**
 * Deterministic in-memory `SchedulerPort`. Tasks never run on their own: they
 * wait in explicit FIFO queues until the matching `flush*` driver runs them.
 * No real timers, no microtask queue, no `requestAnimationFrame`.
 */
export interface FakeScheduler extends SchedulerPort {
    /**
     * Runs every queued microtask FIFO, including tasks enqueued mid-flush,
     * then empties the queue.
     */
    flushMicrotasks(): void
    /**
     * Runs every queued timeout FIFO in one batch, then empties the queue.
     * Delay values only satisfy the signature; they never gate execution.
     */
    flushTimeouts(): void
    /** Counts queued microtasks without running them. */
    pendingMicrotasks(): number
    /** Counts queued (uncancelled) timeouts without running them. */
    pendingTimeouts(): number
}

/**
 * Creates a deterministic scheduler fake. `frame` degrades to a microtask,
 * matching the port contract for environments without `requestAnimationFrame`.
 *
 * @returns A controllable fake scheduler implementing `SchedulerPort`.
 * @example
 * ```ts
 * import { createFakeScheduler } from './scheduler.unit-test.js'
 *
 * const scheduler = createFakeScheduler()
 * scheduler.microtask(() => {})
 * scheduler.flushMicrotasks()
 * ```
 */
export function createFakeScheduler(): FakeScheduler {
    const microtasks: Array<() => void> = []
    const timeouts = new Map<number, () => void>()
    let nextId = 1

    const removeMicrotask = (task: () => void): void => {
        const index = microtasks.indexOf(task)
        if (index >= 0) {
            microtasks.splice(index, 1)
        }
    }

    return {
        microtask(task) {
            microtasks.push(task)
        },
        timeout(task, ms) {
            void ms
            const id = nextId
            nextId += 1
            timeouts.set(id, task)
            return () => {
                timeouts.delete(id)
            }
        },
        frame(task) {
            microtasks.push(task)
            return () => {
                removeMicrotask(task)
            }
        },
        flushMicrotasks() {
            let task = microtasks.shift()
            while (task !== undefined) {
                task()
                task = microtasks.shift()
            }
        },
        flushTimeouts() {
            const pending = [...timeouts.values()]
            timeouts.clear()
            for (const task of pending) {
                task()
            }
        },
        pendingMicrotasks() {
            return microtasks.length
        },
        pendingTimeouts() {
            return timeouts.size
        },
    }
}

/**
 * Reusable `SchedulerPort` contract suite. Every scheduler (fake, DOM) runs
 * the same assertions by supplying a factory for a controllable scheduler.
 *
 * @param create Factory returning a fresh controllable scheduler per test.
 * @example
 * ```ts
 * import { describe } from 'vitest'
 * import { createFakeScheduler, schedulerPortContract } from './scheduler.unit-test.js'
 *
 * describe('fake scheduler', () => {
 *     schedulerPortContract(createFakeScheduler)
 * })
 * ```
 */
export function schedulerPortContract(create: () => FakeScheduler): void {
    it('defers microtasks until flush and drains them in FIFO order', () => {
        const scheduler = create()
        const order: Array<string> = []
        scheduler.microtask(() => {
            order.push('first')
        })
        scheduler.microtask(() => {
            order.push('second')
        })
        scheduler.microtask(() => {
            order.push('third')
        })
        expect(order).toEqual([])
        expect(scheduler.pendingMicrotasks()).toBe(3)
        scheduler.flushMicrotasks()
        expect(order).toEqual(['first', 'second', 'third'])
        expect(scheduler.pendingMicrotasks()).toBe(0)
    })

    it('drains microtasks enqueued during a flush in the same flush', () => {
        const scheduler = create()
        const order: Array<string> = []
        scheduler.microtask(() => {
            order.push('outer')
            scheduler.microtask(() => {
                order.push('inner')
            })
        })
        scheduler.flushMicrotasks()
        expect(order).toEqual(['outer', 'inner'])
    })

    it('runs timeouts on flush and never runs a cancelled timeout', () => {
        const scheduler = create()
        const runs: Array<string> = []
        scheduler.timeout(() => {
            runs.push('kept')
        }, 25)
        const cancel = scheduler.timeout(() => {
            runs.push('cancelled')
        }, 25)
        expect(scheduler.pendingTimeouts()).toBe(2)
        cancel()
        expect(scheduler.pendingTimeouts()).toBe(1)
        scheduler.flushTimeouts()
        expect(runs).toEqual(['kept'])
        expect(scheduler.pendingTimeouts()).toBe(0)
    })

    it('treats cancelling after a flush as an inert no-op', () => {
        const scheduler = create()
        let runs = 0
        const cancel = scheduler.timeout(() => {
            runs += 1
        }, 0)
        scheduler.flushTimeouts()
        expect(runs).toBe(1)
        expect(() => {
            cancel()
        }).not.toThrow()
        expect(runs).toBe(1)
    })

    it('degrades frame to a microtask when requestAnimationFrame is absent', () => {
        expect(typeof requestAnimationFrame).toBe('undefined')
        const scheduler = create()
        let frames = 0
        scheduler.frame(() => {
            frames += 1
        })
        expect(frames).toBe(0)
        scheduler.flushMicrotasks()
        expect(frames).toBe(1)
    })

    it('honours frame cancellation before the degraded microtask runs', () => {
        const scheduler = create()
        let frames = 0
        const cancel = scheduler.frame(() => {
            frames += 1
        })
        cancel()
        scheduler.flushMicrotasks()
        scheduler.flushTimeouts()
        expect(frames).toBe(0)
    })
}

describe('FakeScheduler (deterministic scheduler)', () => {
    schedulerPortContract(createFakeScheduler)
})
