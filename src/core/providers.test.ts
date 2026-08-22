import { describe, expect, it, vi } from 'vitest'
import { createContext } from './context'
import { withProvider } from './providers'
import { createToken } from './types'

describe('withProvider', () => {
    it('registers a provider lazily without calling factory in Phase 1', () => {
        const factorySpy = vi.fn(() => ({ log: () => {} }))
        const bp = createContext({ count: 0 })

        const enrichedBp = withProvider('logger', factorySpy)(bp)

        expect(factorySpy).not.toHaveBeenCalled()
        expect(enrichedBp.providers.has('logger')).toBe(true)
        expect(bp.providers.has('logger')).toBe(false) // Immutability test
    })

    it('supports string tokens and branded ServiceToken', () => {
        interface IAuthService {
            login(): void
        }
        const authToken = createToken<IAuthService>('auth:token')
        const bp = createContext({})

        const enriched = withProvider(authToken, () => ({ login: () => {} }), {
            lifecycle: 'singleton'
        })(bp)

        expect(enriched.providers.has(authToken)).toBe(true)
        const reg = enriched.providers.get(authToken)
        expect(reg?.lifecycle).toBe('singleton')
        expect(reg?.isAsync).toBe(false)
    })

    it('defaults lifecycle to scoped if not specified', () => {
        const bp = createContext({})
        const enriched = withProvider('service', () => 42)(bp)

        const reg = enriched.providers.get('service')
        expect(reg?.lifecycle).toBe('scoped')
        expect(reg?.multi).toBe(false)
    })

    it('supports transient and multi options', () => {
        const bp = createContext({})
        const enriched = withProvider('plugin', () => ({ name: 'p1' }), {
            lifecycle: 'transient',
            multi: true
        })(bp)

        const reg = enriched.providers.get('plugin')
        expect(reg?.lifecycle).toBe('transient')
        expect(reg?.multi).toBe(true)
    })

    it('preserves immutable structural sharing when chaining providers', () => {
        const bp0 = createContext({})
        const bp1 = withProvider('s1', () => 1)(bp0)
        const bp2 = withProvider('s2', () => 2)(bp1)

        expect(bp0.providers.size).toBe(0)
        expect(bp1.providers.size).toBe(1)
        expect(bp2.providers.size).toBe(2)
        expect(bp2.providers.has('s1')).toBe(true)
        expect(bp2.providers.has('s2')).toBe(true)
    })
})
