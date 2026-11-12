import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { onDispose, onMount, onSuspend } from '../api/hooks'
import { createTestApplication } from '../testing/fakes'

describe('hook execution', () => {
    it('[LC #8] onMount FIFO / onDispose LIFO', async () => {
        const order: string[] = []
        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(() => {
                order.push('mount-1')
            }),
            onMount(() => {
                order.push('mount-2')
            }),
            onDispose(() => {
                order.push('dispose-1')
            }),
            onDispose(() => {
                order.push('dispose-2')
            }),
        )
        const { app, adapter } = createTestApplication()
        const session = app.mount(blueprint)(adapter.createHost())

        await session.ready
        expect(order).toEqual(['mount-1', 'mount-2'])

        app.dispose(session)
        expect(order).toEqual(['mount-1', 'mount-2', 'dispose-2', 'dispose-1'])
    })

    it('[LC #8] onDispose 回傳的函式會執行', async () => {
        const order: string[] = []
        const blueprint = pipe(
            createContext({ count: 0 }),
            onDispose(() => {
                order.push('dispose')
                return () => {
                    order.push('cleanup')
                }
            }),
        )
        const { app, adapter } = createTestApplication()
        const session = app.mount(blueprint)(adapter.createHost())
        await session.ready

        app.dispose(session)

        expect(order).toEqual(['dispose', 'cleanup'])
    })

    it('[LC #9] onDispose 的 Promise 拒絕進入 errors$', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(
            pipe(
                createContext({ count: 0 }),
                onDispose(() => Promise.reject(new Error('dispose failed'))),
            ),
        )(adapter.createHost())
        await session.ready

        const codes: string[] = []
        session.errors$.subscribe((error) => codes.push(error.code))
        app.dispose(session)
        await Promise.resolve()
        await Promise.resolve()

        expect(session.status).toBe('disposed')
        expect(codes).toContain('HOOK_ERROR')
    })

    it('[LC #8] 清理函式排在 onDispose 之前且不因暫停執行', async () => {
        const order: string[] = []
        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(() => {
                order.push('mount')
                return () => {
                    order.push('cleanup')
                }
            }),
            onSuspend(() => {
                order.push('suspend')
            }),
            onDispose(() => {
                order.push('dispose')
            }),
        )
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:cleanup' })(host)
        await session.ready

        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()

        expect(order).toEqual(['mount', 'suspend'])

        app.dispose(session)
        expect(order).toEqual(['mount', 'suspend', 'cleanup', 'dispose'])
    })

    it('[LC #9] onMount 失敗使 ready 拒絕且會話 disposed', async () => {
        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(() => {
                throw new Error('mount failed')
            }),
        )
        const { app, adapter } = createTestApplication()
        const session = app.mount(blueprint)(adapter.createHost())

        await expect(session.ready).rejects.toThrow('mount failed')
        expect(session.status).toBe('disposed')
    })

    it('[LC #9] onMount 拋出的非 Error 原樣拒絕 ready', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(
            pipe(
                createContext({ count: 0 }),
                onMount(() => {
                    throw 'mount failed'
                }),
            ),
        )(adapter.createHost())

        await expect(session.ready).rejects.toBe('mount failed')
        expect(session.status).toBe('disposed')
    })

    it('[LC #9] onSuspend 失敗只進 errors$ 且其餘鉤子繼續', async () => {
        const order: string[] = []
        const blueprint = pipe(
            createContext({ count: 0 }),
            onSuspend(() => {
                throw new Error('suspend failed')
            }),
            onSuspend(() => {
                order.push('second-suspend')
            }),
        )
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:hook-error' })(host)
        await session.ready

        const codes: string[] = []
        session.errors$.subscribe((error) => codes.push(error.code))

        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()

        expect(codes).toContain('HOOK_ERROR')
        expect(order).toEqual(['second-suspend'])
    })
})
