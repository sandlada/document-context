import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { defineToken } from '../../domain/model/token'
import { provide } from './provide'
import { createTestApplication } from '../testing/fakes'

const themeToken = defineToken<string>('public')('app:theme')
const missingToken = defineToken<string>('public')('app:missing')

describe('inject', () => {
    it('[SCOPE #1] 單值注入近者勝', async () => {
        const { app, adapter } = createTestApplication()
        const outer = adapter.createHost()
        const inner = adapter.createHost()
        inner.setParent(outer)

        const outerSession = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'outer')),
        )(outer)
        const innerSession = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'inner')),
        )(inner)
        await outerSession.ready
        await innerSession.ready

        await expect(app.inject(themeToken)(inner)).resolves.toBe('inner')
    })

    it('[SCOPE #12] Session 目標無提供者時立即拒絕', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({}))(adapter.createHost())
        await session.ready

        await expect(app.inject(missingToken)(session)).rejects.toMatchObject({
            code: 'UNKNOWN_SERVICE',
        })
    })

    it('[SCOPE #12] 元素目標在提供者出現前保持 pending', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        let settled = false
        const pending = app.inject(themeToken)(host).then((value) => {
            settled = true
            return value
        })

        await Promise.resolve()
        expect(settled).toBe(false)

        const provider = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'late')),
        )(host)
        await provider.ready
        await adapter.clock.flushMicrotasks()

        await expect(pending).resolves.toBe('late')
    })

    it('[SCOPE #13] pending 溢位以 PENDING_LIMIT_EXCEEDED 拒絕', async () => {
        const { app, adapter } = createTestApplication({ limits: { maxPendingInjections: 1 } })
        const first = adapter.createHost()
        const second = adapter.createHost()

        void app.inject(missingToken)(first).catch(() => undefined)
        await expect(app.inject(missingToken)(second)).rejects.toMatchObject({
            code: 'PENDING_LIMIT_EXCEEDED',
        })
    })

    it('[API #18] 對 disposed 會話注入以 DISPOSED_SESSION 拒絕', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({}))(adapter.createHost())
        await session.ready
        app.dispose(session)

        await expect(app.inject(themeToken)(session)).rejects.toMatchObject({
            code: 'DISPOSED_SESSION',
        })
    })

    it('[API #18] disposed 會話的 update 回傳 false', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 0 }))(adapter.createHost())
        await session.ready
        app.dispose(session)

        expect(app.update((state) => ({ count: state.count + 1 }))(session)).toBe(false)
    })

    it('[RX #10] 取消不寫入 errors$', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({}))(host)
        await session.ready

        const errors: string[] = []
        session.errors$.subscribe((error) => errors.push(error.code))

        let failed = false
        const subscription = app.inject$(missingToken)(host).subscribe({
            error: () => {
                failed = true
            },
        })
        subscription.unsubscribe()

        expect(failed).toBe(false)
        expect(errors).toEqual([])
    })

    it('[API #11] inject$ 送出一筆後 complete', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark')),
        )(host)
        await session.ready

        const values: string[] = []
        let completed = false
        await new Promise<void>((resolve) => {
            app.inject$(themeToken)(host).subscribe({
                next: (value) => values.push(value),
                complete: () => {
                    completed = true
                    resolve()
                },
            })
        })

        expect(values).toEqual(['dark'])
        expect(completed).toBe(true)
    })

    it('[SCOPE #1] 存在 multi 註冊時單值注入仍 nearest-wins', async () => {
        const { app, adapter } = createTestApplication()
        const outer = adapter.createHost()
        const inner = adapter.createHost()
        inner.setParent(outer)

        const outerSession = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'outer', { multi: true })),
        )(outer)
        const innerSession = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'inner')),
        )(inner)
        await outerSession.ready
        await innerSession.ready

        await expect(app.inject(themeToken)(inner)).resolves.toBe('inner')
    })
})
