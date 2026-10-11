/**
 * DOM `SchedulerPort` adapter: the single owner of time in the
 * infrastructure layer.
 *
 * DOM globals isolated here: `queueMicrotask`, `setTimeout`/`clearTimeout`,
 * and `requestAnimationFrame`/`cancelAnimationFrame` are read off
 * `globalThis` at call time (never captured at creation), so tests can remove
 * `requestAnimationFrame` to exercise the microtask fallback. No other
 * infrastructure file touches time, and this module touches nothing else.
 */
import type { SchedulerPort } from '../../domain/ports/scheduler.js'

/**
 * Structural view of the animation-frame globals. `unknown` keeps the probe
 * duck-typed: cross-realm functions and test doubles both match, and absence
 * (plain Node) degrades to a microtask.
 */
interface AnimationFrameGlobals {
    readonly requestAnimationFrame?: unknown
    readonly cancelAnimationFrame?: unknown
}

/**
 * Reads the animation-frame globals off `globalThis` at call time.
 *
 * @returns The globals view used by {@link createSchedulerAdapter}.
 * @example
 * ```ts
 * import type { SchedulerPort } from '../../domain/ports/scheduler.js'
 *
 * declare const scheduler: SchedulerPort
 * scheduler.microtask(() => console.log('deferred'))
 * ```
 */
const readFrameGlobals = (): AnimationFrameGlobals => globalThis as unknown as AnimationFrameGlobals

/**
 * Creates a DOM scheduler: `microtask` defers through `queueMicrotask`,
 * `timeout` arms `setTimeout` with a `clearTimeout` cancel, and `frame`
 * prefers `requestAnimationFrame` but MUST degrade to a microtask where it
 * does not exist. Every cancel is idempotent and inert once its task ran.
 *
 * Pure construction: no task runs until the caller schedules one.
 *
 * @returns A `SchedulerPort` bound to the DOM timing globals.
 * @example
 * ```ts
 * import { createSchedulerAdapter } from './scheduler-adapter.js'
 *
 * const scheduler = createSchedulerAdapter()
 * scheduler.microtask(() => console.log('deferred'))
 * const cancel = scheduler.timeout(() => console.log('later'), 50)
 * cancel()
 * ```
 */
export function createSchedulerAdapter(): SchedulerPort {
    return {
        microtask(task: () => void): void {
            queueMicrotask(task)
        },
        timeout(task: () => void, ms: number): () => void {
            let live = true
            const handle = setTimeout(() => {
                if (!live) {
                    return
                }
                live = false
                task()
            }, ms)
            return () => {
                if (!live) {
                    return
                }
                live = false
                clearTimeout(handle)
            }
        },
        frame(task: () => void): () => void {
            const globals = readFrameGlobals()
            if (typeof globals.requestAnimationFrame === 'function') {
                const requestFrame = globals.requestAnimationFrame as (callback: () => void) => number
                let live = true
                const run = (): void => {
                    if (!live) {
                        return
                    }
                    live = false
                    task()
                }
                const handle = requestFrame.call(globalThis, run)
                return () => {
                    if (!live) {
                        return
                    }
                    live = false
                    if (typeof globals.cancelAnimationFrame === 'function') {
                        const cancelFrame = globals.cancelAnimationFrame as (handle: number) => void
                        cancelFrame.call(globalThis, handle)
                    }
                }
            }
            let cancelled = false
            queueMicrotask(() => {
                if (!cancelled) {
                    task()
                }
            })
            return () => {
                cancelled = true
            }
        },
    }
}
