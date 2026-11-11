import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { onAdopt } from '../api/hooks'
import { createTestApplication } from '../testing/fakes'

interface CounterState {
    count: number
}

describe('disconnect', () => {
    it('[LC #3] 斷線後先做一次微任務重掛確認，節點仍在文件中則不暫停', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }), { token: 'app:move' })(host)
        await session.ready

        adapter.setConnected(host, false)
        adapter.setConnected(host, true)
        await adapter.clock.flushMicrotasks()

        expect(session.status).toBe('active')
    })

    it('[LC #4] 匿名會話確認斷線即 dispose', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }))(host)
        await session.ready

        const reasons: string[] = []
        session.lifecycle$.subscribe((event) => {
            if (event.type === 'disposed') {
                reasons.push(event.reason)
            }
        })

        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()

        expect(session.status).toBe('disposed')
        expect(reasons).toEqual(['disconnect'])
    })

    it('[LC #4] keyed 會話確認斷線轉 suspended 並保留狀態', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 3 }), { token: 'app:keep' })(host)
        await session.ready

        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()

        expect(session.status).toBe('suspended')
        expect(app.read((state: CounterState) => state.count)(session)).toBe(3)
    })

    it('[LC #4] 斷線確認前節點回到文件中則不銷毀', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }))(host)
        await session.ready

        adapter.setConnected(host, false)
        adapter.setConnected(host, true)
        await adapter.clock.flushMicrotasks()

        expect(session.status).toBe('active')
    })

    it('[LC #8] 暫停期間 adopt 不執行 onAdopt', async () => {
        const events: string[] = []
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(
            pipe(
                createContext({ count: 0 }),
                onAdopt(() => {
                    events.push('adopt')
                }),
            ),
            { token: 'app:paused-adopt' },
        )(host)
        await session.ready

        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()
        expect(session.status).toBe('suspended')

        adapter.adopt(host, { name: 'other' })

        const seen: string[] = []
        session.lifecycle$.subscribe((event) => seen.push(event.type))

        expect(events).toEqual([])
        expect(seen).toEqual(['suspended'])
    })
})
