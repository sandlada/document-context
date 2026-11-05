import { describe, expect, it } from 'vitest'
import { DocumentContextError } from '../../domain/model/errors'
import type { HostAdapter } from '../../domain/ports/host'
import { createApplication } from '../application'
import { buildPorts } from './ports-contract'
import { createFakeHostAdapter } from '../testing/fakes'

describe('ports contract', () => {
    it('[PORT #8] 每個 adapter 都可被假實作替換', () => {
        const adapter = createFakeHostAdapter()
        const app = createApplication({ host: adapter })

        expect(app.ports.host).toBe(adapter)
        expect(app.limits.maxPendingInjections).toBe(1024)
        expect(app.limits.maxSuspendedSessions).toBe(32)
    })

    it('[PORT #8] 不完整的 host adapter 以 INVALID_OPTIONS 拒絕', () => {
        const incomplete = { normalize: () => ({}) } as unknown as HostAdapter

        try {
            buildPorts({ host: incomplete })
            expect.unreachable('buildPorts should have thrown')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('INVALID_OPTIONS')
        }
    })

    it('[PORT #7] 非 DOM 平台的連線語意由 adapter 自訂', () => {
        const adapter = createFakeHostAdapter()
        const host = adapter.createHost()

        expect(adapter.connectivity.isConnected(host)).toBe(true)
        adapter.setConnected(host, false)
        expect(adapter.connectivity.isConnected(host)).toBe(false)
    })

    it('[PORT #6] Application 級上限可被覆寫', () => {
        const adapter = createFakeHostAdapter()
        const app = createApplication({
            host: adapter,
            limits: { maxPendingInjections: 4, maxSuspendedSessions: 2 },
        })

        expect(app.limits.maxPendingInjections).toBe(4)
        expect(app.limits.maxSuspendedSessions).toBe(2)
    })
})
