import { describe, expect, it } from 'vitest'
import type { ContextRequestDetail, ScopeTransportPort } from './scope-transport'
import type { Host } from '../model/session'

const host: Host = {
    kind: 'element',
    isConnected: true,
    parent: null,
    native: () => ({}),
    on: () => () => undefined,
}

describe('scope transport port', () => {
    it('[PORT #5] 同 Application 走記憶體索引而不派發事件', () => {
        const dispatched: ContextRequestDetail[] = []
        const transport: ScopeTransportPort = {
            authoritative: true,
            hostOf: () => host,
            contains: () => false,
            declarationsOf: () => [],
            declare: () => undefined,
            undeclare: () => undefined,
            onRequest: () => () => undefined,
            request: (_host, detail) => {
                dispatched.push(detail)
            },
            announce: () => undefined,
            onProviderChange: () => () => undefined,
        }

        const detail: ContextRequestDetail = {
            context: 'app:theme',
            callback: () => undefined,
        }
        transport.request(host, detail)

        expect(dispatched).toHaveLength(1)
        expect(dispatched[0]?.context).toBe('app:theme')
    })

    it('[SCOPE #4] resolved 旗標可被提供者設定', () => {
        const detail: ContextRequestDetail = {
            context: 'app:theme',
            callback: () => undefined,
        }
        expect(detail.resolved).toBeUndefined()
        detail.resolved = true
        expect(detail.resolved).toBe(true)
    })
})
