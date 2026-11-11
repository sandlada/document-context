import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { defineToken } from '../../domain/model/token'
import { DocumentContextError } from '../../domain/model/errors'
import { provide } from './provide'
import { createTestApplication } from '../testing/fakes'

const themeToken = defineToken<string>('public')('app:theme')
const missingToken = defineToken<string>('public')('app:missing')

describe('inject', () => {
    it('[API #13] 非法公開名的 inject 拋 TOKEN_INVALID', () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        expect(() => app.inject('no-namespace')(host)).toThrowError(DocumentContextError)
        try {
            app.inject('no-namespace')(host)
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('TOKEN_INVALID')
        }
    })

    it('[API #10] inject 不接受 timeoutMs 或 signal', () => {
        const { app } = createTestApplication()
        app.inject(themeToken, {
            // @ts-expect-error API #10：inject 沒有 timeoutMs
            timeoutMs: 1,
        })
        app.inject(themeToken, {
            // @ts-expect-error API #10：inject 沒有 signal
            signal: new AbortController().signal,
        })
    })

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

    it('[ERR #1] 元素 pending 確認斷線以 UNCONNECTED_HOST 拒絕且不寫入 errors$', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({}))(adapter.createHost())
        await session.ready

        const errors: string[] = []
        session.errors$.subscribe((error) => errors.push(error.code))

        const disconnected = app.inject(themeToken)(host)
        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()

        await expect(disconnected).rejects.toMatchObject({ code: 'UNCONNECTED_HOST' })
        expect(errors).toEqual([])
    })

    it('[ERR #8] Session 目標等待在會話 dispose 後以 DISPOSED_SESSION 拒絕', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({}))(adapter.createHost())
        await session.ready

        const waiting = app.inject(missingToken, { wait: true })(session)
        app.dispose(session)

        await expect(waiting).rejects.toMatchObject({ code: 'DISPOSED_SESSION' })
    })

    it('[RX #7] 釋放 Application 時未決的元素注入以 DISPOSED_SESSION 結束', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const pending = app.inject(themeToken)(host)

        app.release()
        app.release()

        await expect(pending).rejects.toMatchObject({ code: 'DISPOSED_SESSION' })
        expect(() => app.mount(createContext({}))(host)).toThrowError(DocumentContextError)
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

    it('[RX #10] 退訂 inject$ 使串流 complete 且不送錯誤', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({}))(host)
        await session.ready

        const errors: string[] = []
        session.errors$.subscribe((error) => errors.push(error.code))

        let completed = false
        let failed = false
        const subscription = app.inject$(missingToken)(host).subscribe({
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

    it('[LC #10] 進行中的工廠等待在 dispose 時以 DISPOSED_SESSION 結束', async () => {
        const { app, adapter } = createTestApplication()
        let release: (() => void) | undefined
        const session = app.mount(
            pipe(
                createContext({}),
                provide(themeToken, () => new Promise<string>((resolve) => {
                    release = () => resolve('late')
                })),
            ),
        )(adapter.createHost())
        await session.ready

        const pending = app.inject(themeToken)(session)
        const settled = pending.then(
            () => 'fulfilled',
            (error: unknown) => error,
        )
        app.dispose(session)

        let timer: ReturnType<typeof setTimeout> | undefined
        const outcome = await Promise.race([
            settled,
            new Promise<string>((resolve) => {
                timer = setTimeout(() => resolve('timeout'), 300)
            }),
        ])
        if (timer !== undefined) {
            clearTimeout(timer)
        }
        release?.()

        expect(outcome).toMatchObject({ code: 'DISPOSED_SESSION' })
    })
})
