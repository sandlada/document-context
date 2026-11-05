import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { defineToken } from '../../domain/model/token'
import { provide } from './provide'
import { createTestApplication } from '../testing/fakes'

const httpToken = defineToken<{ get(): string }>('public')('app:http')
const profileToken = defineToken<{ name: string }>('public')('app:profile')

describe('provide', () => {
    it('[SCOPE #7] uses 在工廠執行前建立完成', async () => {
        const order: string[] = []
        const blueprint = pipe(
            createContext({}),
            provide(
                httpToken,
                () => {
                    order.push('http')
                    return { get: () => 'ok' }
                },
            ),
            provide(
                profileToken,
                ({ use }) => {
                    order.push('profile')
                    const http = use(httpToken)
                    return { name: http.get() }
                },
                { uses: [httpToken] },
            ),
        )
        const { app, adapter } = createTestApplication()
        const session = app.mount(blueprint)(adapter.createHost())
        await session.ready

        const profile = await app.inject(profileToken)(session)

        expect(order).toEqual(['http', 'profile'])
        expect(profile).toEqual({ name: 'ok' })
    })

    it('[SCOPE #7] use() 同步取得已建立的值', async () => {
        const blueprint = pipe(
            createContext({}),
            provide(httpToken, () => ({ get: () => 'sync' })),
            provide(
                profileToken,
                ({ use }) => ({ name: use(httpToken).get() }),
                { uses: [httpToken] },
            ),
        )
        const { app, adapter } = createTestApplication()
        const session = app.mount(blueprint)(adapter.createHost())
        await session.ready

        await expect(app.inject(profileToken)(session)).resolves.toEqual({ name: 'sync' })
    })

    it('[SCOPE #7] uses 解析不到時 ready 以 UNKNOWN_SERVICE 拒絕', async () => {
        const missing = defineToken<{ get(): string }>('public')('app:missing-http')
        const blueprint = pipe(
            createContext({}),
            provide(
                profileToken,
                ({ use }) => ({ name: use(missing).get() }),
                { uses: [missing] },
            ),
        )
        const { app, adapter } = createTestApplication()
        const session = app.mount(blueprint)(adapter.createHost())

        await expect(session.ready).rejects.toMatchObject({ code: 'UNKNOWN_SERVICE' })
        expect(session.status).toBe('disposed')
    })

    it('[SCOPE #8] uses 有環時 ready 拒絕且環上工廠不執行', async () => {
        let firstCalls = 0
        const a = defineToken<number>('public')('app:cycle-a')
        const b = defineToken<number>('public')('app:cycle-b')
        const blueprint = pipe(
            createContext({}),
            provide(
                a,
                ({ use }) => {
                    firstCalls += 1
                    return use(b) + 1
                },
                { uses: [b] },
            ),
            provide(
                b,
                ({ use }) => {
                    firstCalls += 1
                    return use(a) + 1
                },
                { uses: [a] },
            ),
        )
        const { app, adapter } = createTestApplication()
        const session = app.mount(blueprint)(adapter.createHost())

        await expect(session.ready).rejects.toMatchObject({ code: 'CIRCULAR_DEPENDENCY' })
        expect(firstCalls).toBe(0)
        expect(session.status).toBe('disposed')
    })

    it('[API #1] provide 是 data-last 的藍圖運算子', () => {
        const operator = provide(httpToken, () => ({ get: () => 'ok' }))
        expect(typeof operator).toBe('function')
    })
})
