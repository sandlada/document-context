import { describe, expect, it } from 'vitest'
import type { ConnectivityPort, HostAdapter, TokensPort } from './host'
import type { SchedulerPort } from './scheduler'
import type { ScopeTransportPort } from './scope-transport'
import type { Host } from '../model/session'

const host: Host = {
    kind: 'element',
    isConnected: true,
    parent: null,
    native: () => ({}),
    on: () => () => undefined,
}

const connectivity: ConnectivityPort = {
    isConnected: () => true,
    subscribe: () => () => undefined,
    subscribeStructure: () => () => undefined,
}

const scheduler: SchedulerPort = {
    microtask: () => () => undefined,
    timeout: () => () => undefined,
    frame: () => () => undefined,
}

const scope: ScopeTransportPort = {
    authoritative: true,
    hostOf: () => host,
    contains: () => false,
    declarationsOf: () => [],
    declare: () => undefined,
    undeclare: () => undefined,
    onRequest: () => () => undefined,
    request: () => undefined,
    announce: () => undefined,
    onProviderChange: () => () => undefined,
}

const tokens: TokensPort = {
    read: () => null,
    write: () => undefined,
    remove: () => undefined,
}

describe('host adapter port', () => {
    it('[PORT #8] 每個 adapter 都可被假實作替換', () => {
        const adapter: HostAdapter = {
            normalize: (target: unknown) => {
                expect(target).toBe('target')
                return host
            },
            connectivity,
            scheduler,
            scope,
            tokens,
        }

        expect(adapter.normalize('target')).toBe(host)
    })

    it('[PORT #8] 連線性埠只需回答當下狀態並通知變化', () => {
        let notified = 0
        const unsubscribe = connectivity.subscribe(host, () => {
            notified += 1
        })
        unsubscribe()
        expect(notified).toBe(0)
        expect(connectivity.isConnected(host)).toBe(true)
    })
})
