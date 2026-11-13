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

    it('[SCOPE #9] 後註冊的 singleton 在解析時不執行工廠', async () => {
        const { app, adapter } = createTestApplication()
        const calls: string[] = []
        const first = app.mount(
            pipe(
                createContext({}),
                provide(
                    singletonToken,
                    () => {
                        calls.push('first')
                        return { id: 1 }
                    },
                    { lifecycle: 'singleton' },
                ),
            ),
        )(adapter.createHost())
        await first.ready
        const second = app.mount(
            pipe(
                createContext({}),
                provide(
                    singletonToken,
                    () => {
                        calls.push('second')
                        return { id: 2 }
                    },
                    { lifecycle: 'singleton' },
                ),
            ),
        )(adapter.createHost())
        await second.ready

        await expect(app.inject(singletonToken)(second)).resolves.toEqual({ id: 1 })
        expect(calls).toEqual(['first'])
    })

    it('[SCOPE #9] 擁有者銷毀後 singleton 槽不再交出舊實例', async () => {
        const { app, adapter } = createTestApplication()
        const calls: string[] = []
        const first = app.mount(
            pipe(
                createContext({}),
                provide(
                    singletonToken,
                    () => {
                        calls.push('first')
                        return { id: 1 }
                    },
                    { lifecycle: 'singleton' },
                ),
            ),
        )(adapter.createHost())
        await first.ready
        const second = app.mount(
            pipe(
                createContext({}),
                provide(
                    singletonToken,
                    () => {
                        calls.push('second')
                        return { id: 2 }
                    },
                    { lifecycle: 'singleton' },
                ),
            ),
        )(adapter.createHost())
        await second.ready
        const owned = await app.inject(singletonToken)(second)
        expect(owned).toEqual({ id: 1 })

        app.dispose(first)

        await expect(app.inject(singletonToken)(second)).resolves.toEqual({ id: 2 })
        expect(calls).toEqual(['first', 'second'])
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

    it('[SCOPE #10] transient 進行中的第二次注入仍呼叫工廠', async () => {
        const { app, adapter } = createTestApplication()
        let calls = 0
        const releases: Array<(value: { id: number }) => void> = []
        const session = app.mount(
            pipe(
                createContext({}),
                provide(
                    transientToken,
                    () => new Promise<{ id: number }>((resolve) => {
                        calls += 1
                        const id = calls
                        releases.push(() => resolve({ id }))
                    }),
                    { lifecycle: 'transient' },
                ),
            ),
        )(adapter.createHost())
        await session.ready

        const first = app.inject(transientToken)(session)
        const second = app.inject(transientToken)(session)
        const settled = Promise.all([first, second])
        expect(calls).toBe(2)
        releases[0]?.({ id: 1 })
        releases[1]?.({ id: 2 })

        await expect(settled).resolves.toEqual([{ id: 1 }, { id: 2 }])
        expect((await first)).not.toBe(await second)
    })

    it('[SCOPE #9] transient 的 uses 依賴只建立一次', async () => {
        const { app, adapter } = createTestApplication()
        const outerToken = defineToken<{ dep: { id: number } }>('public')('app:outer')
        let depCalls = 0
        let outerCalls = 0
        const session = app.mount(
            pipe(
                createContext({}),
                provide(
                    transientToken,
                    () => {
                        depCalls += 1
                        return { id: depCalls }
                    },
                    { lifecycle: 'transient' },
                ),
                provide(
                    outerToken,
                    ({ use }) => {
                        outerCalls += 1
                        return { dep: use(transientToken) }
                    },
                    { lifecycle: 'transient', uses: [transientToken] },
                ),
            ),
        )(adapter.createHost())
        await session.ready

        const first = await app.inject(outerToken)(session)
        const second = await app.inject(outerToken)(session)
        await app.inject(transientToken)(session)

        expect(outerCalls).toBe(2)
        expect(first.dep).toBe(second.dep)
        expect(depCalls).toBe(2)
    })

    it('[SCOPE #9] 重疊的 transient 注入只建立一次 uses', async () => {
        const { app, adapter } = createTestApplication()
        const outerToken = defineToken<{ dep: { id: number } }>('public')('app:outer-overlap')
        let depCalls = 0
        let outerCalls = 0
        const session = app.mount(
            pipe(
                createContext({}),
                provide(
                    transientToken,
                    () => {
                        depCalls += 1
                        return { id: depCalls }
                    },
                    { lifecycle: 'transient' },
                ),
                provide(
                    outerToken,
                    ({ use }) => {
                        outerCalls += 1
                        return { dep: use(transientToken) }
                    },
                    { lifecycle: 'transient', uses: [transientToken] },
                ),
            ),
        )(adapter.createHost())
        await session.ready

        const first = app.inject(outerToken)(session)
        const second = app.inject(outerToken)(session)
        const [left, right] = await Promise.all([first, second])

        expect(outerCalls).toBe(2)
        expect(depCalls).toBe(1)
        expect(left).not.toBe(right)
        expect(left.dep).toBe(right.dep)
    })

    it('[SCOPE #9] 後註冊的 multi singleton 不進入 injectAll', async () => {
        const { app, adapter } = createTestApplication()
        const plugin = defineToken<string>('public')('app:plugin-singleton')
        let calls = 0
        const session = app.mount(
            pipe(
                createContext({}),
                provide(
                    plugin,
                    () => {
                        calls += 1
                        return 'first'
                    },
                    { lifecycle: 'singleton', multi: true },
                ),
                provide(
                    plugin,
                    () => {
                        calls += 1
                        return 'second'
                    },
                    { lifecycle: 'singleton', multi: true },
                ),
            ),
        )(adapter.createHost())
        const codes: string[] = []
        session.errors$.subscribe((error) => codes.push(error.code))
        await session.ready

        await expect(app.injectAll(plugin)(session)).resolves.toEqual(['first'])
        expect(calls).toBe(1)
        expect(codes).toContain('SINGLETON_CONFLICT')
    })

    it('[SCOPE #9] multi singleton 佔用後，後註冊的單值工廠不執行', async () => {
        const { app, adapter } = createTestApplication()
        const token = defineToken<string>('public')('app:singleton-mixed')
        let singleCalls = 0
        const owner = app.mount(
            pipe(
                createContext({}),
                provide(token, () => 'multi', { lifecycle: 'singleton', multi: true }),
            ),
        )(adapter.createHost())
        await owner.ready

        const session = app.mount(
            pipe(
                createContext({}),
                provide(token, () => {
                    singleCalls += 1
                    return 'single'
                }, { lifecycle: 'singleton' }),
            ),
        )(adapter.createHost())
        const codes: string[] = []
        session.errors$.subscribe((error) => codes.push(error.code))
        await session.ready

        await expect(app.inject(token)(session)).rejects.toMatchObject({
            code: 'UNKNOWN_SERVICE',
        })
        expect(singleCalls).toBe(0)
        expect(codes).toContain('SINGLETON_CONFLICT')
        await expect(app.injectAll(token)(owner)).resolves.toEqual(['multi'])
    })

    it('[SCOPE #9] 落敗的 eager singleton 在初始化時不執行工廠', async () => {
        const { app, adapter } = createTestApplication()
        const token = defineToken<string>('public')('app:eager-loser')
        let calls = 0
        const owner = app.mount(
            pipe(
                createContext({}),
                provide(token, () => 'multi', { lifecycle: 'singleton', multi: true }),
            ),
        )(adapter.createHost())
        await owner.ready

        const session = app.mount(
            pipe(
                createContext({}),
                provide(token, () => {
                    calls += 1
                    return 'single'
                }, { lifecycle: 'singleton', eager: true }),
            ),
        )(adapter.createHost())
        await session.ready

        expect(session.status).toBe('active')
        expect(calls).toBe(0)
    })

    it('[SCOPE #9] 暫停中的 singleton 擁有者不回答注入', async () => {
        const { app, adapter } = createTestApplication()
        const ownerHost = adapter.createHost()
        const owner = app.mount(
            pipe(
                createContext({}),
                provide(singletonToken, () => ({ id: 1 }), { lifecycle: 'singleton' }),
            ),
            { token: 'app:singleton-owner' },
        )(ownerHost)
        await owner.ready
        adapter.setConnected(ownerHost, false)
        await adapter.clock.flushMicrotasks()
        expect(owner.status).toBe('suspended')

        const second = app.mount(
            pipe(
                createContext({}),
                provide(singletonToken, () => ({ id: 2 }), { lifecycle: 'singleton' }),
            ),
        )(adapter.createHost())
        await second.ready

        await expect(app.inject(singletonToken)(second)).rejects.toMatchObject({
            code: 'UNKNOWN_SERVICE',
        })

        const resumed = app.mount(
            pipe(
                createContext({}),
                provide(singletonToken, () => ({ id: 3 }), { lifecycle: 'singleton' }),
            ),
            { token: 'app:singleton-owner' },
        )(adapter.createHost())
        expect(resumed).toBe(owner)
        await expect(app.inject(singletonToken)(second)).resolves.toEqual({ id: 1 })
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
