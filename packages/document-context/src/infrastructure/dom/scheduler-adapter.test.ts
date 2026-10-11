/**
 * DOM scheduler adapter tests: microtask deferral, cancellable timeouts, and
 * animation-frame scheduling with a mandatory microtask fallback.
 *
 * Runs in happy-dom with real timers. The fallback test removes
 * `requestAnimationFrame` temporarily; the adapter must read it at call time.
 */
import { describe, expect, it } from 'vitest'
import { createSchedulerAdapter } from './scheduler-adapter.js'

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => {
    setTimeout(resolve, 0)
})

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
    setTimeout(resolve, ms)
})

describe('microtask', () => {
    it('defers tasks past the current task and drains FIFO', async () => {
        const scheduler = createSchedulerAdapter()
        const order: Array<string> = []
        scheduler.microtask(() => {
            order.push('first')
        })
        scheduler.microtask(() => {
            order.push('second')
        })
        expect(order).toEqual([])
        await flushMicrotasks()
        expect(order).toEqual(['first', 'second'])
    })
})

describe('timeout', () => {
    it('runs the task after the delay', async () => {
        const scheduler = createSchedulerAdapter()
        let runs = 0
        scheduler.timeout(() => {
            runs += 1
        }, 5)
        expect(runs).toBe(0)
        await wait(40)
        expect(runs).toBe(1)
    })

    it('cancels a pending timeout exactly once and stays inert afterwards', async () => {
        const scheduler = createSchedulerAdapter()
        let runs = 0
        const cancel = scheduler.timeout(() => {
            runs += 1
        }, 5)
        cancel()
        cancel()
        await wait(40)
        expect(runs).toBe(0)
    })

    it('treats cancelling after the run as an inert no-op', async () => {
        const scheduler = createSchedulerAdapter()
        let runs = 0
        const cancel = scheduler.timeout(() => {
            runs += 1
        }, 5)
        await wait(40)
        expect(runs).toBe(1)
        expect(() => {
            cancel()
        }).not.toThrow()
        expect(runs).toBe(1)
    })

    it('drops a firing timeout cancelled in the same turn', async () => {
        const scheduler = createSchedulerAdapter()
        let runs = 0
        const cancel = scheduler.timeout(() => {
            runs += 1
        }, 0)
        cancel()
        await wait(30)
        expect(runs).toBe(0)
    })

    it('honours cancellation without cancelAnimationFrame (run dropped, no throw)', async () => {
        const globals = globalThis as unknown as Record<string, unknown>
        const savedCancel = globals['cancelAnimationFrame']
        globals['cancelAnimationFrame'] = undefined
        try {
            const scheduler = createSchedulerAdapter()
            let frames = 0
            const cancel = scheduler.frame(() => {
                frames += 1
            })
            expect(() => cancel()).not.toThrow()
            await wait(80)
            expect(frames).toBe(0)
        } finally {
            globals['cancelAnimationFrame'] = savedCancel
        }
    })
})

describe('frame', () => {
    it('runs the task on a later turn (rAF or microtask fallback)', async () => {
        const scheduler = createSchedulerAdapter()
        let frames = 0
        scheduler.frame(() => {
            frames += 1
        })
        expect(frames).toBe(0)
        await wait(80)
        expect(frames).toBe(1)
    })

    it('honours cancellation before the task runs', async () => {
        const scheduler = createSchedulerAdapter()
        let frames = 0
        const cancel = scheduler.frame(() => {
            frames += 1
        })
        cancel()
        cancel()
        await wait(80)
        expect(frames).toBe(0)
    })

    it('degrades to a microtask when requestAnimationFrame is absent', async () => {
        const globals = globalThis as unknown as Record<string, unknown>
        const savedFrame = globals['requestAnimationFrame']
        const savedCancel = globals['cancelAnimationFrame']
        globals['requestAnimationFrame'] = undefined
        try {
            const scheduler = createSchedulerAdapter()
            let frames = 0
            scheduler.frame(() => {
                frames += 1
            })
            expect(frames).toBe(0)
            await flushMicrotasks()
            expect(frames).toBe(1)
        } finally {
            globals['requestAnimationFrame'] = savedFrame
            globals['cancelAnimationFrame'] = savedCancel
        }
    })

    it('honours fallback cancellation before the microtask runs', async () => {
        const globals = globalThis as unknown as Record<string, unknown>
        const savedFrame = globals['requestAnimationFrame']
        globals['requestAnimationFrame'] = undefined
        try {
            const scheduler = createSchedulerAdapter()
            let frames = 0
            const cancel = scheduler.frame(() => {
                frames += 1
            })
            cancel()
            await flushMicrotasks()
            expect(frames).toBe(0)
        } finally {
            globals['requestAnimationFrame'] = savedFrame
        }
    })
})
