import { describe, expect, it, vi } from 'vitest'
import { createContext } from './context'
import { withAsyncProvider } from './async-provider'
import { createToken } from './types'

describe('withAsyncProvider operator', () => {
    it('registers an async provider lazily without invoking asyncFactory in Phase 1', () => {
        const factorySpy = vi.fn(async () => ({ user: 'admin' }))
        const bp = createContext({})

        const enriched = withAsyncProvider('api:user', factorySpy)(bp)

        expect(factorySpy).not.toHaveBeenCalled()
        expect(enriched.providers.has('api:user')).toBe(true)

        const reg = enriched.providers.get('api:user')
        expect(reg?.isAsync).toBe(true)
        expect(reg?.lifecycle).toBe('scoped')
    })

    it('supports branded ServiceToken and lifecycle options', () => {
        interface IRemoteData {
            fetch(): Promise<string>
        }
        const token = createToken<IRemoteData>('remote:data')
        const bp = createContext({})

        const enriched = withAsyncProvider(
            token,
            async () => ({ fetch: async () => 'data' }),
            { lifecycle: 'singleton' }
        )(bp)

        const reg = enriched.providers.get(token)
        expect(reg?.lifecycle).toBe('singleton')
        expect(reg?.isAsync).toBe(true)
    })
})
