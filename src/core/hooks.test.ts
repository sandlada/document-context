import { describe, expect, it } from 'vitest'
import { createContext } from './context'
import { withHook } from './hooks'

describe('withHook', () => {
    it('registers a lifecycle hook lazily into blueprint', () => {
        const bp = createContext({ count: 0 })
        const mountHandler = () => () => {}

        const enriched = withHook('mount', mountHandler)(bp)

        expect(enriched.hooks.length).toBe(1)
        expect(enriched.hooks[0]).toEqual({
            event: 'mount',
            handler: mountHandler
        })
        expect(bp.hooks.length).toBe(0) // Immutability test
    })

    it('supports registering multiple hooks for different lifecycle events', () => {
        const bp = createContext({})
        const onMount = () => {}
        const onDispose = () => {}
        const onSuspend = () => {}
        const onResuscitate = () => {}
        const onAdopt = () => {}

        const result = withHook(
            'adopt',
            onAdopt
        )(
            withHook(
                'resuscitate',
                onResuscitate
            )(
                withHook(
                    'suspend',
                    onSuspend
                )(withHook('dispose', onDispose)(withHook('mount', onMount)(bp)))
            )
        )

        expect(result.hooks.length).toBe(5)
        expect(result.hooks.map((h) => h.event)).toEqual([
            'mount',
            'dispose',
            'suspend',
            'resuscitate',
            'adopt'
        ])
    })

    it('preserves immutable structural sharing', () => {
        const bp0 = createContext({ a: 1 })
        const h1 = () => {}
        const h2 = () => {}

        const bp1 = withHook('mount', h1)(bp0)
        const bp2 = withHook('dispose', h2)(bp1)

        expect(bp0.hooks.length).toBe(0)
        expect(bp1.hooks.length).toBe(1)
        expect(bp2.hooks.length).toBe(2)
        expect(bp0.initialState).toEqual({ a: 1 })
    })
})
