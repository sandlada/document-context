import { describe, expect, it } from 'vitest'
import { createContext } from '../../domain/model/blueprint'
import { createTestApplication } from '../testing/fakes'

interface CounterState {
    count: number
}

describe('subscribe$', () => {
    it('[RX #1] 新訂閱立即取得當前快照', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 5 }))(adapter.createHost())
        await session.ready

        const seen: number[] = []
        app.subscribe$((state: CounterState) => seen.push(state.count))(session)

        expect(seen).toEqual([5])
    })

    it('[RX #2] 推送在 update 的同一個呼叫堆疊內發生', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 0 }))(adapter.createHost())
        await session.ready

        const seen: number[] = []
        app.subscribe$((state: CounterState) => seen.push(state.count))(session)

        app.update((state: CounterState) => ({ count: state.count + 1 }))(session)

        expect(seen).toEqual([0, 1])
    })

    it('[RX #3] disposed 時 state$ 完成', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 0 }))(adapter.createHost())
        await session.ready

        let completed = false
        session.state$.subscribe({
            complete: () => {
                completed = true
            },
        })
        app.dispose(session)

        expect(completed).toBe(true)
    })

    it('[RX #7] 銷毀後無活動訂閱', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 0 }))(adapter.createHost())
        await session.ready

        let received = 0
        const subscription = app.subscribe$(() => {
            received += 1
        })(session)

        app.dispose(session)
        subscription.unsubscribe()

        expect(received).toBe(1)
    })
})
