import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { defineToken, type Token } from '../../domain/model/token'
import { DocumentContextError } from '../../domain/model/errors'
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

    it('[SCOPE #7] 祖先還在 starting 時 uses 仍會等到它的工廠', async () => {
        const parentToken = defineToken<string>('public')('app:parent-value')
        const childToken = defineToken<string>('public')('app:child-value')
        const { app, adapter } = createTestApplication()
        const outer = adapter.createHost()
        const inner = adapter.createHost()
        inner.setParent(outer)

        let release: ((value: string) => void) | undefined
        const parent = app.mount(
            pipe(
                createContext({}),
                provide(
                    parentToken,
                    () => new Promise<string>((resolve) => {
                        release = resolve
                    }),
                    { eager: true },
                ),
            ),
        )(outer)
        const child = app.mount(
            pipe(
                createContext({}),
                provide(
                    childToken,
                    ({ use }) => use(parentToken),
                    { uses: [parentToken], eager: true },
                ),
            ),
        )(inner)

        const ready = child.ready.then(
            () => 'ready',
            (error: unknown) => error,
        )
        await Promise.resolve()
        release?.('from-parent')

        await expect(ready).resolves.toBe('ready')
        await expect(app.inject(childToken)(child)).resolves.toBe('from-parent')
        await parent.ready
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

    it('[SCOPE #8] 動態等待繞回自己以 CIRCULAR_DEPENDENCY 拒絕', async () => {
        const a = defineToken<string>('public')('app:dynamic-a')
        const b = defineToken<string>('public')('app:dynamic-b')
        const { app, adapter } = createTestApplication()
        const session = app.mount(
            pipe(
                createContext({}),
                provide(
                    a,
                    async ({ session: current }) => {
                        await Promise.resolve()
                        return app.inject(b)(current)
                    },
                    { eager: true },
                ),
                provide(b, ({ session: current }) => app.inject(a)(current)),
            ),
        )(adapter.createHost())

        let timer: ReturnType<typeof setTimeout> | undefined
        const outcome = await Promise.race([
            session.ready.then(
                () => 'ready',
                (error: unknown) => error,
            ),
            new Promise<string>((resolve) => {
                timer = setTimeout(() => resolve('timeout'), 300)
            }),
        ])
        if (timer !== undefined) {
            clearTimeout(timer)
        }

        expect(outcome).toMatchObject({ code: 'CIRCULAR_DEPENDENCY' })
        expect(session.status).toBe('disposed')
    })

    it('[SCOPE #8] 元素目標注入 starting 中的自己以 CIRCULAR_DEPENDENCY 拒絕', async () => {
        const token = defineToken<string>('public')('app:self-element')
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(
            pipe(
                createContext({}),
                provide(
                    token,
                    async ({ session: current }) => {
                        await Promise.resolve()
                        return app.inject(token)(current.host.native())
                    },
                    { eager: true },
                ),
            ),
        )(host)

        let timer: ReturnType<typeof setTimeout> | undefined
        const outcome = await Promise.race([
            session.ready.then(
                () => 'ready',
                (error: unknown) => error,
            ),
            new Promise<string>((resolve) => {
                timer = setTimeout(() => resolve('timeout'), 300)
            }),
        ])
        if (timer !== undefined) {
            clearTimeout(timer)
        }

        expect(outcome).toMatchObject({ code: 'CIRCULAR_DEPENDENCY' })
        expect(session.status).toBe('disposed')
    })

    it('[SCOPE #10] 另一個工廠可以等待已開始的工廠', async () => {
        const a = defineToken<string>('public')('app:started-a')
        const b = defineToken<string>('public')('app:started-b')
        const { app, adapter } = createTestApplication()
        let release: (() => void) | undefined
        const session = app.mount(
            pipe(
                createContext({}),
                provide(a, () => new Promise<string>((resolve) => {
                    release = () => resolve('a')
                })),
                provide(b, ({ session: current }) => app.inject(a)(current)),
            ),
        )(adapter.createHost())
        await session.ready

        const pending = app.inject(a)(session)
        const throughB = app.inject(b)(session)
        release?.()

        await expect(throughB).resolves.toBe('a')
        await expect(pending).resolves.toBe('a')
    })

    it('[SCOPE #8] 工廠同步 inject 自己以 CIRCULAR_DEPENDENCY 拒絕', async () => {
        const self = defineToken<string>('public')('app:self')
        const { app, adapter } = createTestApplication()
        const blueprint = pipe(
            createContext({}),
            provide(self, ({ session }) => app.inject(self)(session), { eager: true }),
        )
        const session = app.mount(blueprint)(adapter.createHost())

        await expect(session.ready).rejects.toMatchObject({ code: 'CIRCULAR_DEPENDENCY' })
        expect(session.status).toBe('disposed')
    })

    it('[API #13] 非法公開名的 provide 拋 TOKEN_INVALID', () => {
        const illegal = 'no-namespace' as Token<number>
        expect(() => provide(illegal, () => 1)).toThrowError(DocumentContextError)
        try {
            provide(illegal, () => 1)
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('TOKEN_INVALID')
        }
    })

    it('[API #13] 私有 token 不走公開名稱驗證', () => {
        const secret = defineToken<number>('private')('not a public name')
        expect(() => provide(secret, () => 1)).not.toThrow()
    })

    it('[API #1] provide 是 data-last 的藍圖運算子', () => {
        const operator = provide(httpToken, () => ({ get: () => 'ok' }))
        expect(typeof operator).toBe('function')
    })

    it('同一藍圖裡後註冊的單值覆蓋先註冊的 eager 工廠', async () => {
        const token = defineToken<string>('public')('app:override')
        const calls: string[] = []
        const blueprint = pipe(
            createContext({}),
            provide(
                token,
                () => {
                    calls.push('first')
                    return 'first'
                },
                { eager: true },
            ),
            provide(
                token,
                () => {
                    calls.push('second')
                    return 'second'
                },
                { eager: true },
            ),
        )
        const { app, adapter } = createTestApplication()
        const session = app.mount(blueprint)(adapter.createHost())
        await session.ready

        await expect(app.inject(token)(session)).resolves.toBe('second')
        expect(calls).toEqual(['second'])
    })
})
