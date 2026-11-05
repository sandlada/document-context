import { describe, expect, it } from 'vitest'
import type { SsrPort } from './ssr'

describe('ssr port', () => {
    it('[PORT #7] SSR 埠提供每請求一個的占位宿主', () => {
        const ssr: SsrPort = {
            createHost: () => ({ kind: 'server' }),
        }

        const first = ssr.createHost()
        const second = ssr.createHost()

        expect(first.kind).toBe('server')
        expect(first).not.toBe(second)
    })
})
