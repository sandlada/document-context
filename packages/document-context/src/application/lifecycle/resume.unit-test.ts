import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { onResume } from '../api/hooks'
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
})
