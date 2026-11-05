import { describe, expect, it } from 'vitest'
import { DocumentContextError } from '../../domain/model/errors'
import { createApplication } from '../application'
import { createTestApplication } from '../testing/fakes'

describe('application isolation', () => {
    it('[SCOPE #14] 跨 Application 操作同一 Session 被拒絕', async () => {
        const { app, adapter } = createTestApplication()
        const other = createApplication({ host: adapter })
        const session = app.mount({ state: {}, providers: [], hooks: [] })(adapter.createHost())
        await session.ready

        expect(() => other.update(() => ({}))(session)).toThrow(DocumentContextError)
        expect(() => other.dispose(session)).toThrow(DocumentContextError)
    })

    it('[SCOPE #14] 跨 Application 拒絕的錯誤碼為 FOREIGN_SESSION', async () => {
        const { app, adapter } = createTestApplication()
        const other = createApplication({ host: adapter })
        const session = app.mount({ state: {}, providers: [], hooks: [] })(adapter.createHost())
        await session.ready

        try {
            other.update(() => ({}))(session)
            expect.unreachable('the operation should have been rejected')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('FOREIGN_SESSION')
        }
    })

    it('[PORT #3] 兩個 Application 的 singleton 槽互不影響', async () => {
        const { adapter } = createTestApplication()
        const first = createApplication({ host: adapter })
        const second = createApplication({ host: adapter })

        expect(first.ports).not.toBe(second.ports)
    })

    it('[PORT #6] keyed 暫存表與 pending 表歸 Application', async () => {
        const { app, adapter } = createTestApplication()
        const other = createApplication({ host: adapter })

        const session = app.mount({ state: {}, providers: [], hooks: [] }, { token: 'app:scoped' })(
            adapter.createHost(),
        )
        await session.ready

        expect(() => other.mount({ state: {}, providers: [], hooks: [] }, { token: 'app:scoped' })(
            adapter.createHost(),
        )).not.toThrow()
    })

    it('[SCOPE #3] 同 Application 解析不產生 context-request 事件', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount({ state: {}, providers: [], hooks: [] })(host)
        await session.ready

        const before = adapter.scope.requestCount()
        void app.inject('app:missing', { wait: true })(host).catch(() => undefined)

        expect(adapter.scope.requestCount()).toBe(before)
    })

    it('[PORT #5] 同 Application 走記憶體索引', async () => {
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount({ state: {}, providers: [], hooks: [] })(host)
        await session.ready

        expect(adapter.scope.requestCount()).toBe(0)
    })
})
