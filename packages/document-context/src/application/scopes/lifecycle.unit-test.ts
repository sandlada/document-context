import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { defineToken } from '../../domain/model/token'
import { provide } from '../api/provide'
import { createTestApplication } from '../testing/fakes'

const scopedToken = defineToken<{ id: number }>('public')('app:scoped')
const singletonToken = defineToken<{ id: number }>('public')('app:singleton')
const transientToken = defineToken<{ id: number }>('public')('app:transient')

describe('injection lifecycle', () => {
    it('[SCOPE #9] scoped 每 Session 一份', async () => {
        const { app, adapter } = createTestApplication()
        const blueprint = pipe(
            createContext({}),
            provide(scopedToken, () => ({ id: Math.random() })),
        )
        const first = app.mount(blueprint)(adapter.createHost())
        const second = app.mount(blueprint)(adapter.createHost())
        await first.ready
        await second.ready

        const a = await app.inject(scopedToken)(first)
        const b = await app.inject(scopedToken)(second)

        expect(a).not.toBe(b)
    })

    it('[SCOPE #9] singleton 每 Application 一份且先註冊者勝', async () => {
        const { app, adapter } = createTestApplication()
        let calls = 0
        const blueprint = pipe(
            createContext({}),
            provide(
                singletonToken,
                () => {
                    calls += 1
                    return { id: calls }
                },
                { lifecycle: 'singleton' },
            ),
        )
        const first = app.mount(blueprint)(adapter.createHost())
        const second = app.mount(blueprint)(adapter.createHost())
        await first.ready
        await second.ready

        const a = await app.inject(singletonToken)(first)
        const b = await app.inject(singletonToken)(second)

        expect(a).toBe(b)
        expect(calls).toBe(1)
    })

    it('[SCOPE #9] 重複 singleton 的 errors$ 收到 SINGLETON_CONFLICT', async () => {
        const { app, adapter } = createTestApplication()
        const blueprint = pipe(
            createContext({}),
            provide(singletonToken, () => ({ id: 1 }), { lifecycle: 'singleton' }),
        )
        const first = app.mount(blueprint)(adapter.createHost())
        await first.ready

        const second = app.mount(blueprint)(adapter.createHost())
        const codes: string[] = []
        second.errors$.subscribe((error) => codes.push(error.code))
        await second.ready

        expect(codes).toContain('SINGLETON_CONFLICT')
        expect(second.status).toBe('active')
    })

    it('[SCOPE #9] transient 每次注入重新呼叫工廠', async () => {
        const { app, adapter } = createTestApplication()
        let calls = 0
        const blueprint = pipe(
            createContext({}),
            provide(
                transientToken,
                () => {
                    calls += 1
                    return { id: calls }
                },
                { lifecycle: 'transient' },
            ),
        )
        const session = app.mount(blueprint)(adapter.createHost())
        await session.ready

        const first = await app.inject(transientToken)(session)
        const second = await app.inject(transientToken)(session)

        expect(first).not.toBe(second)
        expect(calls).toBe(2)
    })

    it('[SCOPE #9] prototype 與 transient 行為相同', async () => {
        const { app, adapter } = createTestApplication()
        let calls = 0
        const blueprint = pipe(
            createContext({}),
            provide(
                transientToken,
                () => {
                    calls += 1
                    return { id: calls }
                },
                { lifecycle: 'prototype' },
            ),
        )
        const session = app.mount(blueprint)(adapter.createHost())
        await session.ready

        await app.inject(transientToken)(session)
        await app.inject(transientToken)(session)

        expect(calls).toBe(2)
    })

    it('[SCOPE #10] 進行中的 Promise 合併為同一個', async () => {
        const { app, adapter } = createTestApplication()
        let calls = 0
        const deferred: { resolve: (() => void) | null } = { resolve: null }
        const blueprint = pipe(
            createContext({}),
            provide(
                scopedToken,
                async () => {
                    calls += 1
                    await new Promise<void>((resolve) => {
                        deferred.resolve = resolve
                    })
                    return { id: calls }
                },
            ),
        )
        const session = app.mount(blueprint)(adapter.createHost())
        await session.ready

        const first = app.inject(scopedToken)(session)
        const second = app.inject(scopedToken)(session)
        deferred.resolve?.()

        expect(await first).toBe(await second)
        expect(calls).toBe(1)
    })

    it('[SCOPE #10] 拒絕後清快取可重試', async () => {
        const { app, adapter } = createTestApplication()
        let calls = 0
        const blueprint = pipe(
            createContext({}),
            provide(scopedToken, async () => {
                calls += 1
                if (calls === 1) {
                    throw new Error('factory failed')
                }
                return { id: calls }
            }),
        )
        const session = app.mount(blueprint)(adapter.createHost())
        await session.ready

        await expect(app.inject(scopedToken)(session)).rejects.toThrow('factory failed')
        await expect(app.inject(scopedToken)(session)).resolves.toEqual({ id: 2 })
    })
})
