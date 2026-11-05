import { describe, expect, it, vi } from 'vitest'
import type { DocumentContextError } from './domain/model/errors'

/**
 * The root entry must be importable in Node without touching a DOM global, and a browser only path
 * must fail with an explicit error instead of `document is not defined`.
 */
describe('root entry', () => {
    it('[PORT #1] 根入口在 Node 環境匯入不觸及 DOM 全域', async () => {
        vi.resetModules()
        const touched: string[] = []
        const names = ['document', 'window', 'MutationObserver', 'requestAnimationFrame']
        for (const name of names) {
            Object.defineProperty(globalThis, name, {
                configurable: true,
                get(): undefined {
                    touched.push(name)
                    return undefined
                },
            })
        }

        try {
            const root = await import('./index')

            expect(touched).toEqual([])
            expect(typeof root.mount).toBe('function')
            expect(typeof root.inject).toBe('function')
            expect(typeof root.pipe).toBe('function')
            expect(typeof root.createContext).toBe('function')
            expect(typeof root.defineToken).toBe('function')
        } finally {
            for (const name of names) {
                Reflect.deleteProperty(globalThis, name)
            }
        }
    })

    it('[PORT #1] Node 上呼叫瀏覽器專屬路徑拋明確錯誤', async () => {
        vi.resetModules()
        const root = await import('./index')

        try {
            root.mount({ state: {}, providers: [], hooks: [] })({} as unknown as Element)
            expect.unreachable('the browser only path should have thrown')
        } catch (error) {
            expect(error).not.toBeInstanceOf(ReferenceError)
            expect((error as DocumentContextError).code).toBe('HOST_INVALID')
            expect((error as Error).message).toContain('document')
        }
    })

    it('[PORT #1] Phase 1 運算子在 Node 環境可直接使用', async () => {
        vi.resetModules()
        const root = await import('./index')

        const token = root.defineToken<string>('public')('app:node')
        const blueprint = root.pipe(
            root.createContext({ count: 0 }),
            root.provide(token, () => 'value'),
        )

        expect(blueprint.state).toEqual({ count: 0 })
        expect(blueprint.providers).toHaveLength(1)
        expect(blueprint.providers[0]?.token).toBe('app:node')
    })
})
