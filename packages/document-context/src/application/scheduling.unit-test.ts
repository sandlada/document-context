import { describe, expect, it } from 'vitest'
import { scheduleRecheck } from './scheduling'
import { createTestApplication } from './testing/fakes'

describe('scheduling', () => {
    it('[RX #8] 重掛確認走排程埠而不是直接排程', async () => {
        const { app, adapter, clock } = createTestApplication()
        const host = adapter.createHost()
        let confirmed = false

        adapter.setConnected(host, false)
        scheduleRecheck(app as never, host, () => {
            confirmed = true
        })

        expect(confirmed).toBe(false)
        await clock.flushMicrotasks()
        expect(confirmed).toBe(true)
    })

    it('[RX #8] 節點仍在文件中時不報告斷線', async () => {
        const { app, adapter, clock } = createTestApplication()
        const host = adapter.createHost()
        let confirmed = false

        adapter.setConnected(host, false)
        adapter.setConnected(host, true)
        scheduleRecheck(app as never, host, () => {
            confirmed = true
        })

        await clock.flushMicrotasks()
        expect(confirmed).toBe(false)
    })

    it('[RX #8] 假排程器不使用真實計時器', () => {
        const { clock } = createTestApplication()

        expect(clock.now()).toBe(0)
        clock.advance(1000)
        expect(clock.now()).toBe(1000)
        expect(clock.pendingTimeouts()).toBe(0)
    })
})
