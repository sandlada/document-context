import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { onMount, onResume, onSuspend } from '../api/hooks'
import { createApplication } from '../application'
import { createTestApplication } from '../testing/fakes'

interface CounterState {
    count: number
}

describe('resume', () => {
    it('[LC #5] TTL 內同 token 回到新宿主可恢復且狀態保留', async () => {
        const { app, adapter } = createTestApplication()
        const blueprint = pipe(
            createContext({ count: 0 }),
            onResume(() => undefined),
        )
        const first = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:resume' })(first)
        await session.ready
        app.update((state: CounterState) => ({ count: state.count + 4 }))(session)

        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()
        expect(session.status).toBe('suspended')

        const second = adapter.createHost()
        const resumed = app.mount(blueprint, { token: 'app:resume' })(second)

        expect(resumed).toBe(session)
        expect(resumed.status).toBe('active')
        expect(app.read((state: CounterState) => state.count)(resumed)).toBe(4)
    })

    it('[LC #5] 恢復時執行 onResume', async () => {
        const resumed: string[] = []
        const { app, adapter } = createTestApplication()
        const blueprint = pipe(
            createContext({ count: 0 }),
            onResume(() => {
                resumed.push('resume')
            }),
        )
        const first = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:resume-hook' })(first)
        await session.ready

        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()
        app.mount(blueprint, { token: 'app:resume-hook' })(adapter.createHost())

        expect(resumed).toEqual(['resume'])
    })

    it('[SCOPE #11] 恢復時把 keyed 身分搬到新宿主', async () => {
        const { app, adapter } = createTestApplication()
        const first = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }), { token: 'app:moved' })(first)
        await session.ready
        expect(adapter.tokens.read(first)).toBe('app:moved')

        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()

        const second = adapter.createHost()
        app.mount(createContext({ count: 0 }), { token: 'app:moved' })(second)

        expect(session.status).toBe('active')
        expect(adapter.tokens.read(second)).toBe('app:moved')
        expect(adapter.tokens.read(first)).toBeNull()
    })

    it('[LC #8] 恢復時不重複執行已跑過的 onMount', async () => {
        const order: string[] = []
        const { app, adapter } = createTestApplication()
        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(() => {
                order.push('mount')
            }),
            onResume(() => {
                order.push('resume')
            }),
        )
        const first = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:mount-once' })(first)
        await session.ready
        expect(order).toEqual(['mount'])

        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()
        const second = adapter.createHost()
        app.mount(blueprint, { token: 'app:mount-once' })(second)
        expect(order).toEqual(['mount', 'resume'])
    })

    it('[LC #2] 初始化期 suspended 首次恢復補跑 onMount', async () => {
        const order: string[] = []
        const { app, adapter } = createTestApplication()
        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(() => {
                order.push('mount')
            }),
            onResume(() => {
                order.push('resume')
            }),
        )
        const first = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:deferred-mount' })(first)
        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()
        await session.ready
        expect(session.status).toBe('suspended')
        expect(order).toEqual([])

        const second = adapter.createHost()
        app.mount(blueprint, { token: 'app:deferred-mount' })(second)
        expect(order).toEqual(['mount', 'resume'])
        expect(session.status).toBe('active')
    })

    it('[LC #2] 補跑的 onMount Promise 落定後才 onResume', async () => {
        const order: string[] = []
        let resolveMount: () => void = () => undefined
        const { app, adapter } = createTestApplication()
        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(
                () =>
                    new Promise<void>((resolve) => {
                        resolveMount = () => {
                            order.push('mount')
                            resolve()
                        }
                    }),
            ),
            onResume(() => {
                order.push('resume')
            }),
        )
        const first = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:async-mount' })(first)
        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()
        await session.ready
        expect(session.status).toBe('suspended')

        app.mount(blueprint, { token: 'app:async-mount' })(adapter.createHost())
        expect(order).toEqual([])
        expect(session.status).toBe('suspended')

        resolveMount()
        await Promise.resolve()
        await Promise.resolve()

        expect(order).toEqual(['mount', 'resume'])
        expect(session.status).toBe('active')
    })

    it('[LC #9] 補跑的 onMount Promise 拒絕時不進入 active', async () => {
        const { app, adapter } = createTestApplication()
        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(() => Promise.reject(new Error('mount failed'))),
        )
        const first = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:async-mount-fail' })(first)
        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()
        await session.ready

        app.mount(blueprint, { token: 'app:async-mount-fail' })(adapter.createHost())
        await Promise.resolve()
        await Promise.resolve()

        expect(session.status).toBe('disposed')
    })

    it('[LC #2] 補跑 onMount 期間宿主又斷線則不進入 active', async () => {
        const order: string[] = []
        let resolveMount: () => void = () => undefined
        const { app, adapter } = createTestApplication()
        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(
                () =>
                    new Promise<void>((resolve) => {
                        resolveMount = resolve
                    }),
            ),
            onResume(() => {
                order.push('resume')
            }),
        )
        const first = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:async-disconnect' })(first)
        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()
        await session.ready

        const second = adapter.createHost()
        app.mount(blueprint, { token: 'app:async-disconnect' })(second)
        adapter.setConnected(second, false)
        await adapter.clock.flushMicrotasks()
        resolveMount()
        await Promise.resolve()
        await Promise.resolve()

        expect(order).toEqual([])
        expect(session.status).toBe('suspended')

        const third = adapter.createHost()
        const resumed = app.mount(blueprint, { token: 'app:async-disconnect' })(third)
        expect(resumed).toBe(session)
        resolveMount()
        await Promise.resolve()
        await Promise.resolve()
        expect(session.status).toBe('active')
    })

    it('[LC #8] 恢復時 onMount 清理函式只登記一次', async () => {
        let cleanupRuns = 0
        const { app, adapter } = createTestApplication()
        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(() => {
                return () => {
                    cleanupRuns += 1
                }
            }),
            onResume(() => undefined),
        )
        const first = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:cleanup-once' })(first)
        await session.ready

        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()
        app.mount(blueprint, { token: 'app:cleanup-once' })(adapter.createHost())

        app.dispose(session)
        expect(cleanupRuns).toBe(1)
    })

    it('[LC #6] TTL 到期以 reason ttl 銷毀', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }), { token: 'app:ttl' })(host)
        await session.ready

        const reasons: string[] = []
        session.lifecycle$.subscribe((event) => {
            if (event.type === 'disposed') {
                reasons.push(event.reason)
            }
        })

        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()
        expect(session.status).toBe('suspended')

        adapter.clock.advance(4999)
        expect(session.status).toBe('suspended')

        adapter.clock.advance(1)
        expect(session.status).toBe('disposed')
        expect(reasons).toEqual(['ttl'])
    })

    it('[LC #6] suspensionTtlMs 為 0 時確認斷線直接銷毀且不暫停', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const hooks: string[] = []
        const session = app.mount(
            pipe(
                createContext({ count: 0 }),
                onSuspend(() => {
                    hooks.push('suspend')
                }),
            ),
            { token: 'app:zero-ttl', suspensionTtlMs: 0 },
        )(host)
        await session.ready

        const events: string[] = []
        session.lifecycle$.subscribe((event) => {
            events.push(event.type === 'disposed' ? `disposed:${event.reason}` : event.type)
        })

        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()

        expect(session.status).toBe('disposed')
        expect(hooks).toEqual([])
        expect(events).toEqual(['active', 'disposed:disconnect'])
    })

    it('[LC #6] pinned 不受 TTL 影響', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }), {
            token: 'app:pinned',
            retention: 'pinned',
        })(host)
        await session.ready

        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()

        adapter.clock.advance(100000)

        expect(session.status).toBe('suspended')
    })

    it('[LC #7] 暫停上限淘汰最舊的一份', async () => {
        const { app, adapter } = createTestApplication({ limits: { maxSuspendedSessions: 1 } })
        const first = adapter.createHost()
        const second = adapter.createHost()

        const oldest = app.mount(createContext({ count: 0 }), { token: 'app:old' })(first)
        const newer = app.mount(createContext({ count: 0 }), { token: 'app:new' })(second)
        await oldest.ready
        await newer.ready

        const reasons: string[] = []
        oldest.lifecycle$.subscribe((event) => {
            if (event.type === 'disposed') {
                reasons.push(event.reason)
            }
        })

        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()
        adapter.setConnected(second, false)
        await adapter.clock.flushMicrotasks()

        expect(oldest.status).toBe('disposed')
        expect(reasons).toEqual(['cap'])
        expect(newer.status).toBe('suspended')
    })

    it('[LC #7] 暫停上限不跨 Application 合併計數', async () => {
        const { app, adapter, clock } = createTestApplication({
            limits: { maxSuspendedSessions: 1 },
        })
        const other = createApplication({
            host: adapter,
            limits: { maxSuspendedSessions: 1 },
        })

        const first = adapter.createHost()
        const second = adapter.createHost()

        const own = app.mount(createContext({ count: 0 }), { token: 'app:mine' })(first)
        const theirs = other.mount(createContext({ count: 0 }), { token: 'app:theirs' })(second)
        await own.ready
        await theirs.ready

        adapter.setConnected(first, false)
        await clock.flushMicrotasks()
        adapter.setConnected(second, false)
        await clock.flushMicrotasks()

        expect(own.status).toBe('suspended')
        expect(theirs.status).toBe('suspended')
    })

    it('[LC #8] 恢復時補跑的 onMount 依 FIFO 等待 Promise', async () => {
        const { app, adapter } = createTestApplication()
        const order: string[] = []
        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(() => {
                order.push('first-start')
                return Promise.resolve().then(() => {
                    order.push('first-end')
                })
            }),
            onMount(() => {
                order.push('second-start')
                return Promise.resolve().then(() => {
                    order.push('second-end')
                })
            }),
            onResume(() => {
                order.push('resume')
            }),
        )
        const first = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:mount-fifo' })(first)
        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()
        await session.ready

        expect(session.status).toBe('suspended')
        expect(order).toEqual([])

        const second = adapter.createHost()
        const resumed = app.mount(blueprint, { token: 'app:mount-fifo' })(second)
        for (let step = 0; step < 6; step += 1) {
            await Promise.resolve()
        }

        expect(resumed).toBe(session)
        expect(order).toEqual([
            'first-start',
            'first-end',
            'second-start',
            'second-end',
            'resume',
        ])
        expect(session.status).toBe('active')
    })

    it('[LC #8] onSuspend 的 Promise 落定後才跑下一個鉤子並進入 suspended', async () => {
        const { app, adapter } = createTestApplication()
        const order: string[] = []
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const host = adapter.createHost()
        const session = app.mount(
            pipe(
                createContext({ count: 0 }),
                onSuspend(() => {
                    order.push('first')
                    return gate.then(() => {
                        order.push('first-done')
                    })
                }),
                onSuspend(() => {
                    order.push('second')
                }),
            ),
            { token: 'app:suspend-promise' },
        )(host)
        await session.ready

        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()

        expect(order).toEqual(['first'])
        expect(session.status).toBe('active')

        release()
        for (let step = 0; step < 6; step += 1) {
            await Promise.resolve()
        }

        expect(order).toEqual(['first', 'first-done', 'second'])
        expect(session.status).toBe('suspended')
    })

    it('[LC #8] onResume 的 Promise 落定後才進入 active', async () => {
        const { app, adapter } = createTestApplication()
        const order: string[] = []
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const blueprint = pipe(
            createContext({ count: 0 }),
            onResume(() => {
                order.push('resume')
                return gate.then(() => {
                    order.push('resume-done')
                })
            }),
        )
        const first = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:resume-promise' })(first)
        await session.ready
        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()
        expect(session.status).toBe('suspended')

        const second = adapter.createHost()
        const resumed = app.mount(blueprint, { token: 'app:resume-promise' })(second)

        expect(resumed).toBe(session)
        expect(order).toEqual(['resume'])
        expect(session.status).toBe('suspended')

        release()
        for (let step = 0; step < 6; step += 1) {
            await Promise.resolve()
        }

        expect(order).toEqual(['resume', 'resume-done'])
        expect(session.status).toBe('active')
    })

    it('[LC #9] onSuspend 的 Promise 拒絕後仍進入 suspended', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(
            pipe(
                createContext({ count: 0 }),
                onSuspend(() => Promise.reject(new Error('suspend failed'))),
                onSuspend(() => undefined),
            ),
            { token: 'app:suspend-reject' },
        )(host)
        await session.ready

        const codes: string[] = []
        session.errors$.subscribe((error) => codes.push(error.code))
        adapter.setConnected(host, false)
        await adapter.clock.flushMicrotasks()
        for (let step = 0; step < 6; step += 1) {
            await Promise.resolve()
        }

        expect(codes).toContain('HOOK_ERROR')
        expect(session.status).toBe('suspended')
    })

    it('[LC #5] onSuspend 的 Promise 尚未落定時，同 token 掛到新宿主會恢復', async () => {
        const { app, adapter } = createTestApplication()
        const order: string[] = []
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const blueprint = pipe(
            createContext({ count: 1 }),
            onSuspend(() => {
                order.push('suspend')
                return gate.then(() => {
                    order.push('suspend-done')
                })
            }),
            onResume(() => {
                order.push('resume')
            }),
        )
        const first = adapter.createHost()
        const session = app.mount(blueprint, { token: 'app:overlap' })(first)
        await session.ready
        app.update({ count: 2 })(session)

        adapter.setConnected(first, false)
        await adapter.clock.flushMicrotasks()
        expect(session.status).toBe('active')
        expect(order).toEqual(['suspend'])

        const second = adapter.createHost()
        const resumed = app.mount(blueprint, { token: 'app:overlap' })(second)

        expect(resumed).toBe(session)
        expect(order).toEqual(['suspend'])
        expect(app.read((state: CounterState) => state.count)(session)).toBe(2)

        release()
        for (let step = 0; step < 8; step += 1) {
            await Promise.resolve()
        }

        expect(order).toEqual(['suspend', 'suspend-done', 'resume'])
        expect(session.status).toBe('active')
        expect(app.read((state: CounterState) => state.count)(session)).toBe(2)
    })
})
