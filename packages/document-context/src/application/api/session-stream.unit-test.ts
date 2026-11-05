import { describe, expect, it } from 'vitest'
import { createContext } from '../../domain/model/blueprint'
import { createTestApplication } from '../testing/fakes'

describe('sessionAt / session$', () => {
    it('[RX #9] sessionAt 只認 active 且宿主仍連線的會話', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const child = adapter.createHost()
        child.setParent(host)

        const session = app.mount(createContext({ count: 0 }))(host)
        await session.ready

        expect(app.sessionAt(child)).toBe(session)
    })

    it('[RX #9] starting 期間對 sessionAt 不可見', () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()

        app.mount(createContext({ count: 0 }))(host)

        expect(app.sessionAt(host)).toBeNull()
    })

    it('[RX #9] session$ 立刻收到當前最近會話', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }))(host)
        await session.ready

        const seen: unknown[] = []
        app.session$(host).subscribe((value) => seen.push(value))

        expect(seen).toEqual([session])
    })

    it('[RX #9] session$ 在沒有會話時收到 null', () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()

        const seen: unknown[] = []
        app.session$(host).subscribe((value) => seen.push(value))

        expect(seen).toEqual([null])
    })
})
