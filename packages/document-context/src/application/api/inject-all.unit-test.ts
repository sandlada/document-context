import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { defineToken } from '../../domain/model/token'
import { provide } from './provide'
import { createTestApplication } from '../testing/fakes'

const pluginToken = defineToken<string>('public')('app:plugin')
const singleToken = defineToken<string>('public')('app:single')

describe('injectAll', () => {
    it('[SCOPE #5] injectAll 只收集 multi 註冊', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(
            pipe(
                createContext({}),
                provide(pluginToken, () => 'multi', { multi: true }),
                provide(singleToken, () => 'single'),
            ),
        )(host)
        await session.ready

        await expect(app.injectAll(pluginToken)(session)).resolves.toEqual(['multi'])
    })

    it('[SCOPE #6] 預設近到遠 / from-top-to-bottom 反向', async () => {
        const { app, adapter } = createTestApplication()
        const outer = adapter.createHost()
        const inner = adapter.createHost()
        inner.setParent(outer)

        const outerSession = app.mount(
            pipe(createContext({}), provide(pluginToken, () => 'outer', { multi: true })),
        )(outer)
        const innerSession = app.mount(
            pipe(createContext({}), provide(pluginToken, () => 'inner', { multi: true })),
        )(inner)
        await outerSession.ready
        await innerSession.ready

        await expect(app.injectAll(pluginToken)(inner)).resolves.toEqual(['inner', 'outer'])
        await expect(
            app.injectAll(pluginToken, { direction: 'from-top-to-bottom' })(inner),
        ).resolves.toEqual(['outer', 'inner'])
    })

    it('[SCOPE #6] 同一宿主的多筆 multi 保持註冊順序', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(
            pipe(
                createContext({}),
                provide(pluginToken, () => 'first', { multi: true }),
                provide(pluginToken, () => 'second', { multi: true }),
            ),
        )(host)
        await session.ready

        await expect(app.injectAll(pluginToken)(session)).resolves.toEqual(['first', 'second'])
    })

    it('[API #11] Session 目標的空多值立即以 [] 結束', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({}))(adapter.createHost())
        await session.ready

        await expect(app.injectAll(pluginToken)(session)).resolves.toEqual([])
    })

    it('[RX #10] 退訂 injectAll$ 使串流 complete 且不送錯誤', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({}))(host)
        await session.ready
        const errors: string[] = []
        session.errors$.subscribe((error) => errors.push(error.code))

        let completed = false
        let failed = false
        const subscription = app.injectAll$(pluginToken)(host).subscribe({
            error: () => {
                failed = true
            },
            complete: () => {
                completed = true
            },
        })
        subscription.unsubscribe()

        expect(completed).toBe(true)
        expect(failed).toBe(false)
        expect(errors).toEqual([])
    })

    it('[SCOPE #12] Session 目標 injectAll 帶 wait 時保持 pending', async () => {
        const { app, adapter } = createTestApplication()
        const outer = adapter.createHost()
        const inner = adapter.createHost()
        inner.setParent(outer)
        const session = app.mount(createContext({}))(inner)
        await session.ready

        let settled = false
        const pending = app.injectAll(pluginToken, { wait: true })(session).then((values) => {
            settled = true
            return values
        })
        pending.catch(() => {
            settled = true
        })
        await Promise.resolve()
        expect(settled).toBe(false)

        const provider = app.mount(
            pipe(createContext({}), provide(pluginToken, () => 'outer', { multi: true })),
        )(outer)
        await provider.ready
        await adapter.clock.flushMicrotasks()

        await expect(pending).resolves.toEqual(['outer'])
    })

    it('[RX #6] inject$ 為冷流且 resolve-once', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(
            pipe(createContext({}), provide(pluginToken, () => 'multi', { multi: true })),
        )(host)
        await session.ready

        const values: string[][] = []
        await new Promise<void>((resolve) => {
            app.injectAll$(pluginToken)(host).subscribe({
                next: (value) => values.push(value),
                complete: resolve,
            })
        })

        expect(values).toEqual([['multi']])
    })

    it('[SCOPE #5] 單值 inject 不受 multi 註冊影響', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(
            pipe(
                createContext({}),
                provide(pluginToken, () => 'single'),
                provide(pluginToken, () => 'multi', { multi: true }),
            ),
        )(host)
        await session.ready

        // multi 註冊是「累加」而不是「覆蓋」：單值仍拿到單值註冊的那一份。
        await expect(app.inject(pluginToken)(session)).resolves.toBe('single')
        await expect(app.injectAll(pluginToken)(session)).resolves.toEqual(['multi'])
    })

    it('[SCOPE #5] 只有 multi 註冊的宿主不回答單值 inject', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(
            pipe(createContext({}), provide(pluginToken, () => 'multi', { multi: true })),
        )(host)
        await session.ready

        await expect(app.inject(pluginToken)(session)).rejects.toMatchObject({
            code: 'UNKNOWN_SERVICE',
        })
    })
})
