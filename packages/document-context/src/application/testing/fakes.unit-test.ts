import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import type { Host, ServerHost, Session } from '../../domain/model/session'
import { onAdopt } from '../api/hooks'
import { createApplication } from '../application'
import { createFakeHost, createFakeHostAdapter, createTestApplication } from './fakes'

describe('fake ports', () => {
    it('[PORT #8] 假宿主的 on 遵守 AbortSignal', () => {
        const host = createFakeHost()
        const already = new AbortController()
        already.abort()
        let calls = 0
        host.on('ping', () => {
            calls += 1
        }, { signal: already.signal })

        const later = new AbortController()
        host.on('ping', () => {
            calls += 1
        }, { signal: later.signal })
        later.abort()

        for (const listener of host.listeners.get('ping') ?? []) {
            listener({
                type: 'ping',
                target: host,
                currentTarget: host,
                defaultPrevented: false,
            })
        }

        expect(calls).toBe(0)
        expect(host.listeners.get('ping')?.size ?? 0).toBe(0)
    })

    it('[PORT #8] 仍連線的 adopt 只轉發 onAdopt', async () => {
        const events: string[] = []
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(createContext({ count: 0 }))(host)
        await session.ready

        app.attach({
            onConnect: () => {
                events.push('connect')
            },
            onDisconnect: () => {
                events.push('disconnect')
            },
            onAdopt: () => {
                events.push('adopt')
            },
        })(session)
        adapter.adopt(host, { name: 'other' })

        expect(events).toEqual(['adopt'])
        expect(session.status).toBe('active')
    })

    it('[PORT #8] adopt 通知會讓 onAdopt 執行且會話保持 active', async () => {
        const events: string[] = []
        const { app, adapter } = createTestApplication()
        const host = adapter.createHost()
        const session = app.mount(
            pipe(
                createContext({ count: 0 }),
                onAdopt(() => {
                    events.push('adopt')
                }),
            ),
        )(host)
        await session.ready

        adapter.adopt(host, { document: 'other' })

        expect(events).toEqual(['adopt'])
        expect(session.status).toBe('active')
    })

    it('[PORT #8] 假宿主可以配上 SSR 埠掛載占位宿主', async () => {
        const adapter = createFakeHostAdapter()
        const app = createApplication({
            host: adapter,
            ssr: {
                createHost(): ServerHost {
                    return { kind: 'server' }
                },
            },
        })
        const session = (
            app.mount(createContext({ count: 3 })) as (target: ServerHost) => Session<{ count: number }, Host>
        )({ kind: 'server' })
        await session.ready

        expect(session.status).toBe('active')
        expect(session.host.kind).toBe('server')
        expect(app.read((state: { count: number }) => state.count)(session)).toBe(3)
    })
})
