import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../../src/domain/model/blueprint'
import { defineToken } from '../../../src/domain/model/token'
import { provide } from '../../../src/application/api/provide'
import { onDispose, onMount, onResume, onSuspend } from '../../../src/application/api/hooks'
import { createSsrApplication } from '../../../src/infrastructure/ssr/index'
import type { ServerHost } from '../../../src/domain/model/session'

const counterToken = defineToken<{ value: number }>('public')('app:counter')

function serverHost(): ServerHost {
    return { kind: 'server' }
}

describe('ssr application', () => {
    it('[API #19] SSR 上不支援元素目標', async () => {
        const app = createSsrApplication()
        const session = app.mount(
            pipe(createContext({}), provide(counterToken, () => ({ value: 1 }))),
        )(serverHost())
        await session.ready

        // 型別上元素目標本來就不被接受；這裡繞過型別，驗證執行期的拒絕。
        const element = { nodeName: 'DIV' } as unknown as ServerHost

        await expect(app.inject(counterToken)(element)).rejects.toMatchObject({
            code: 'UNKNOWN_SERVICE',
        })
        await expect(app.injectAll(counterToken)(element)).rejects.toMatchObject({
            code: 'UNKNOWN_SERVICE',
        })
    })

    it('[API #19] SSR 上以 Session 為目標可以解析', async () => {
        const app = createSsrApplication()
        const session = app.mount(
            pipe(createContext({}), provide(counterToken, () => ({ value: 7 }))),
        )(serverHost())
        await session.ready

        await expect(app.inject(counterToken)(session)).resolves.toEqual({ value: 7 })
    })

    it('[LC #9] 伺服器不跑 onMount / onSuspend / onResume 但跑 onDispose', async () => {
        const app = createSsrApplication()
        const calls: string[] = []

        const session = app.mount(
            pipe(
                createContext({}),
                onMount(() => {
                    calls.push('mount')
                }),
                onSuspend(() => {
                    calls.push('suspend')
                }),
                onResume(() => {
                    calls.push('resume')
                }),
                onDispose(() => {
                    calls.push('dispose')
                }),
            ),
        )(serverHost())
        await session.ready

        expect(calls).toEqual([])

        app.dispose(session)

        expect(calls).toEqual(['dispose'])
    })

    it('[PORT #3] 每個請求各自一個 Application 且互不共享狀態', async () => {
        const first = createSsrApplication()
        const second = createSsrApplication()

        const firstSession = first.mount(
            pipe(
                createContext({ count: 0 }),
                provide(counterToken, () => ({ value: 1 }), { lifecycle: 'singleton' }),
            ),
        )(serverHost())
        const secondSession = second.mount(
            pipe(
                createContext({ count: 0 }),
                provide(counterToken, () => ({ value: 1 }), { lifecycle: 'singleton' }),
            ),
        )(serverHost())
        await firstSession.ready
        await secondSession.ready

        const firstValue = await first.inject(counterToken)(firstSession)
        const secondValue = await second.inject(counterToken)(secondSession)

        expect(firstValue).not.toBe(secondValue)
        expect(first.read((state: { count: number }) => state.count)(firstSession)).toBe(0)
        expect(second.read((state: { count: number }) => state.count)(secondSession)).toBe(0)
    })

    it('[RX #7] 釋放是冪等且釋放後沒有殘留', async () => {
        const app = createSsrApplication()
        const session = app.mount(pipe(createContext({})))(serverHost())
        await session.ready

        app.dispose(session)
        app.release()
        app.release()

        expect(session.status).toBe('disposed')
        expect(() => app.mount(pipe(createContext({})))(serverHost())).toThrowError(
            expect.objectContaining({ code: 'DISPOSED_SESSION' }),
        )
    })
})
