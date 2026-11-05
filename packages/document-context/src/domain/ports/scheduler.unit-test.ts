import { describe, expect, it } from 'vitest'
import type { SchedulerPort } from './scheduler'

describe('scheduler port', () => {
    it('[PORT #4] 每個排程都回傳取消函式', () => {
        const scheduler: SchedulerPort = {
            microtask: () => () => undefined,
            timeout: () => () => undefined,
            frame: () => () => undefined,
        }

        expect(typeof scheduler.microtask(() => undefined)).toBe('function')
        expect(typeof scheduler.timeout(() => undefined, 10)).toBe('function')
        expect(typeof scheduler.frame(() => undefined)).toBe('function')
    })

    it('[RX #8] 排程埠提供微任務、逾時與影格三種能力', () => {
        const scheduler: SchedulerPort = {
            microtask: () => () => undefined,
            timeout: () => () => undefined,
            frame: () => () => undefined,
        }

        expect(Object.keys(scheduler).sort()).toEqual(['frame', 'microtask', 'timeout'])
    })
})
