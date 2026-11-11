import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { defineToken } from '../../domain/model/token'
import { DocumentContextError } from '../../domain/model/errors'
import { provide } from './provide'
import { onMount, onSuspend } from './hooks'
import { createTestApplication } from '../testing/fakes'

const eagerToken = defineToken<number>('public')('app:eager')
const counterToken = defineToken<number>('public')('app:counter')

describe('mount', () => {
    it('[LC #1] mount 同步回傳 Session 且 status 為 starting', () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(createContext({ count: 0 }))(adapter.createHost())

        expect(session.status).toBe('starting')
        expect(session.ready).toBeInstanceOf(Promise)
    })

    it('[LC #2] ready 在 eager 與 onMount 之後才 fulfill', async () => {
        const order: string[] = []
        const blueprint = pipe(
            createContext({ count: 0 }),
            provide(
                eagerToken,
                () => {
                    order.push('eager')
                    return 1
                },
                { eager: true },
            ),
            onMount(() => {
                order.push('mount')
            }),
        )
        const { app, adapter } = createTestApplication()
        const session = app.mount(blueprint)(adapter.createHost())

        await session.ready

        expect(order).toEqual(['eager', 'mount'])
        expect(session.status).toBe('active')
    })

    it('[LC #2] 初始化期間轉 suspended 不執行 onSuspend', async () => {
        const order: string[] = []
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(
            pipe(
                createContext({ count: 0 }),
                onSuspend(() => {
                    order.push('suspend')
                }),
            ),
            { token: 'app:no-suspend-on-init' },
        )(host)
        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()
        await session.ready
        expect(session.status).toBe('suspended')
        expect(order).toEqual([])
    })

    it('[LC #2] 初始化期間確認斷線的 keyed 會話轉 suspended 並 fulfill', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }), { token: 'app:keyed' })(host)

        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()
        await session.ready

        expect(session.status).toBe('suspended')
    })

    it('[LC #2] 初始化期間確認斷線的匿名會話以 UNCONNECTED_HOST 拒絕', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }))(host)

        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()

        await expect(session.ready).rejects.toMatchObject({ code: 'UNCONNECTED_HOST' })
        expect(session.status).toBe('disposed')
    })

    it('[LC #13] reset 以舊當前狀態作種子且順序不變', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const first = app.mount(createContext({ count: 0 }))(host)
        await first.ready
        app.update((state) => ({ count: state.count + 5 }))(first)

        const second = app.mount(createContext({ count: 0 }), {
            onConflict: 'reset',
        })(host)
        await second.ready

        expect(app.read((state) => state.count)(second)).toBe(5)
        expect(first.status).toBe('disposed')
    })

    it('[LC #13] replace 銷毀舊會話且不經過 suspended', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const first = app.mount(createContext({ count: 0 }))(host)
        await first.ready

        const events: string[] = []
        first.lifecycle$.subscribe((event) => events.push(event.type))

        const second = app.mount(createContext({ count: 0 }), {
            onConflict: 'replace',
        })(host)
        await second.ready

        expect(first.status).toBe('disposed')
        expect(events).not.toContain('suspended')
    })

    it('[API #15] Infinity 未搭配 pinned 拋 INVALID_OPTIONS', () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()

        try {
            app.mount(createContext({ count: 0 }), { suspensionTtlMs: Infinity })(host)
            expect.unreachable('mount should have thrown')
        } catch (error) {
            expect(error).toBeInstanceOf(DocumentContextError)
            expect((error as DocumentContextError).code).toBe('INVALID_OPTIONS')
        }
    })

    it('[API #15] Infinity 搭配 pinned 可掛載', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }), {
            suspensionTtlMs: Infinity,
            retention: 'pinned',
        })(host)

        await session.ready
        expect(session.status).toBe('active')
    })

    it('[API #16] starting 期間 abort 使 ready 以 signal.reason 拒絕', async () => {
        const { app, adapter } = createTestApplication()
        const controller = new AbortController()
        const session = app.mount(createContext({ count: 0 }), {
            signal: controller.signal,
        })(adapter.createHost())

        controller.abort(new Error('cancelled by the caller'))

        await expect(session.ready).rejects.toThrow('cancelled by the caller')
        expect(session.status).toBe('disposed')
    })

    it('[API #17] 跨宿主同 keyed token 拋 KEYED_CONFLICT', async () => {
        const { app, adapter } = createTestApplication()
        const first = app.mount(createContext({ count: 0 }), { token: 'app:shared' })(
            adapter.createHost(),
        )
        await first.ready

        try {
            app.mount(createContext({ count: 0 }), { token: 'app:shared' })(
                adapter.createHost(),
            )
            expect.unreachable('mount should have thrown')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('KEYED_CONFLICT')
        }
    })

    it('[API #17] 同一宿主的衝突依 onConflict 預設 throw', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        await app.mount(createContext({ count: 0 }))(host)

        try {
            app.mount(createContext({ count: 0 }))(host)
            expect.unreachable('mount should have thrown')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('KEYED_CONFLICT')
        }
    })

    it('[API #17] 跨宿主衝突不受 replace 影響', async () => {
        const { app, adapter } = createTestApplication()
        const first = app.mount(createContext({ count: 0 }), { token: 'app:shared' })(
            adapter.createHost(),
        )
        await first.ready

        try {
            app.mount(createContext({ count: 0 }), {
                token: 'app:shared',
                onConflict: 'replace',
            })(adapter.createHost())
            expect.unreachable('mount should have thrown')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('KEYED_CONFLICT')
        }
        expect(first.status).toBe('active')
    })

    it('[API #17] 跨宿主衝突在銷毀同宿主會話之前拒絕', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const local = app.mount(createContext({ count: 1 }), { token: 'app:local' })(host)
        const shared = app.mount(createContext({ count: 2 }), { token: 'app:shared' })(
            adapter.createHost(),
        )
        await local.ready
        await shared.ready

        expect(() =>
            app.mount(createContext({ count: 0 }), {
                token: 'app:shared',
                onConflict: 'replace',
            })(host),
        ).toThrowError(DocumentContextError)

        expect(local.status).toBe('active')
        expect(shared.status).toBe('active')
        expect(app.read((state: { count: number }) => state.count)(local)).toBe(1)
    })

    it('[API #17] replace 復甦暫停中的 token 時不留下舊會話', async () => {
        const { app, adapter } = createTestApplication()
        const parked = adapter.createHost()
        const shared = app.mount(createContext({ count: 4 }), { token: 'app:shared' })(parked)
        await shared.ready
        adapter.setConnected(parked, false)
        await adapter.clock.flushMicrotasks()
        expect(shared.status).toBe('suspended')

        const host = adapter.createHost()
        const local = app.mount(createContext({ count: 1 }), { token: 'app:local' })(host)
        await local.ready

        const resumed = app.mount(createContext({ count: 0 }), {
            token: 'app:shared',
            onConflict: 'replace',
        })(host)

        expect(local.status).toBe('disposed')
        expect(resumed).toBe(shared)
        expect(resumed.status).toBe('active')
        expect(app.read((state: { count: number }) => state.count)(resumed)).toBe(4)
    })

    it('[LC #1] keyed 會話的 token 會被寫回宿主', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }), { token: 'app:written' })(host)

        await session.ready
        expect(session.token).toBe('app:written')
        expect(adapter.tokens.read(host)).toBe('app:written')
    })

    it('[SCOPE #9] eager 依賴在初始化時建立一次', async () => {
        let calls = 0
        const blueprint = pipe(
            createContext({ count: 0 }),
            provide(
                counterToken,
                () => {
                    calls += 1
                    return calls
                },
                { eager: true },
            ),
        )
        const { app, adapter } = createTestApplication()
        const session = app.mount(blueprint)(adapter.createHost())

        await session.ready
        expect(calls).toBe(1)
        expect(await app.inject(counterToken)(session)).toBe(1)
    })
})
