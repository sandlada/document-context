import { describe, expect, it } from 'vitest'
import { createContext } from '../../domain/model/blueprint'
import { createTestApplication } from '../testing/fakes'

interface CounterState {
    count: number
}

describe('read', () => {
    it('[API #9] read 同步回傳當下快照', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 7 }))(adapter.createHost())
        await session.ready

        expect(app.read((state: CounterState) => state.count)(session)).toBe(7)
    })

    it('[API #9] disposed 後仍回傳最後一筆快照', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 3 }))(adapter.createHost())
        await session.ready
        app.dispose(session)

        expect(app.read((state: CounterState) => state.count)(session)).toBe(3)
    })

    it('[API #20] ready 後狀態仍可變', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 0 }))(adapter.createHost())
        await session.ready

        app.update((state: CounterState) => ({ count: state.count + 1 }))(session)

        expect(app.read((state: CounterState) => state.count)(session)).toBe(1)
    })
})
