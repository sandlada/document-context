import { describe, expect, it } from 'vitest'
import { createContext } from '../../domain/model/blueprint'
import { createTestApplication } from '../testing/fakes'

interface CounterState {
    count: number
    label?: string
}

describe('update', () => {
    it('[LC #12] starting 期間的 update 依序重放', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext<CounterState>({ count: 0 }))(adapter.createHost())

        app.update((state: CounterState) => ({ count: state.count + 1 }))(session)
        app.update((state: CounterState) => ({ count: state.count + 10 }))(session)

        await session.ready

        expect(app.read((state: CounterState) => state.count)(session)).toBe(11)
    })

    it('[API #5] updater 回傳型別不含 Promise', () => {
        // @ts-expect-error API #5：updater 必須同步，回傳型別不含 Promise
        const rejected: (state: CounterState) => CounterState = (state) => Promise.resolve(state)
        expect(typeof rejected).toBe('function')
    })

    it('[API #3] update 整份替換並刪除未寫回的鍵', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(
            createContext({ count: 0, label: 'first' } as CounterState),
        )(adapter.createHost())
        await session.ready

        app.update((state: CounterState) => ({ count: state.count + 1 }))(session)

        expect(app.read((state: CounterState) => state)(session)).toEqual({ count: 1 })
    })

    it('[API #3] disposed 會話的 update 回傳 false', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 0 }))(adapter.createHost())
        await session.ready
        app.dispose(session)

        expect(app.update((state: CounterState) => ({ count: state.count + 1 }))(session)).toBe(
            false,
        )
    })

    it('[API #4] updater 拋錯原樣外拋且狀態不變', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 0 }))(adapter.createHost())
        await session.ready

        expect(() =>
            app.update((_state: CounterState) => {
                throw new Error('boom')
            })(session),
        ).toThrow('boom')

        expect(app.read((state: CounterState) => state.count)(session)).toBe(0)
    })

    it('[API #8] suspended 期間仍可更新且訂閱者收到推送', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }), { token: 'app:suspend' })(host)
        await session.ready

        const seen: number[] = []
        app.subscribe$((state: CounterState) => seen.push(state.count))(session)

        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()
        expect(session.status).toBe('suspended')

        app.update((state: CounterState) => ({ count: state.count + 1 }))(session)

        expect(seen).toEqual([0, 1])
    })

    it('[RX #2] 推送同步發生且引用相同不推送', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 0 }))(adapter.createHost())
        await session.ready

        const seen: number[] = []
        app.subscribe$((state: CounterState) => seen.push(state.count))(session)

        const snapshot = app.read((state: CounterState) => state)(session)
        app.update(() => snapshot)(session)
        expect(seen).toEqual([0])

        app.update((state: CounterState) => ({ count: 1 }))(session)
        expect(seen).toEqual([0, 1])
    })
})
