import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { onDispose } from './hooks'
import { createTestApplication } from '../testing/fakes'

describe('dispose', () => {
    it('[LC #10] dispose 同步中止 abort 邊界', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 0 }))(adapter.createHost())
        await session.ready

        expect(session.abortSignal.aborted).toBe(false)
        app.dispose(session)
        expect(session.abortSignal.aborted).toBe(true)
    })

    it('[LC #10] dispose 讓 state$ 與 lifecycle$ 完成', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 0 }))(adapter.createHost())
        await session.ready

        let stateCompleted = false
        let lifecycleCompleted = false
        session.state$.subscribe({ complete: () => (stateCompleted = true) })
        session.lifecycle$.subscribe({ complete: () => (lifecycleCompleted = true) })

        app.dispose(session)

        expect(stateCompleted).toBe(true)
        expect(lifecycleCompleted).toBe(true)
    })

    it('[LC #10] asyncDispose 等待非同步清理', async () => {
        let cleaned = false
        const blueprint = pipe(
            createContext({ count: 0 }),
            onDispose(async () => {
                await Promise.resolve()
                cleaned = true
            }),
        )
        const { app, adapter } = createTestApplication()
        const session = app.mount(blueprint)(adapter.createHost())
        await session.ready

        await session[Symbol.asyncDispose]()

        expect(cleaned).toBe(true)
        expect(session.status).toBe('disposed')
    })

    it('[LC #10] dispose 同步開工但不等候非同步清理', async () => {
        let cleaned = false
        const blueprint = pipe(
            createContext({ count: 0 }),
            onDispose(async () => {
                await Promise.resolve()
                cleaned = true
            }),
        )
        const { app, adapter } = createTestApplication()
        const session = app.mount(blueprint)(adapter.createHost())
        await session.ready

        app.dispose(session)

        expect(session.status).toBe('disposed')
        expect(cleaned).toBe(false)
    })
})
