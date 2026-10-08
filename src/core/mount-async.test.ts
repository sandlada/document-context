import { describe, expect, it } from 'vitest'
import { createContext } from './context'
import { withAsyncProvider } from './async-provider'
import { mountAsync } from './mount-async'
import { select } from './select'

describe('mountAsync', () => {
    it('mounts session and returns a promise resolving to ISession', async () => {
        const el = document.createElement('div')
        const bp = createContext({ count: 10 })

        const session = await mountAsync(bp)(el)

        expect(session).toBeDefined()
        expect(session.target).toBe(el)
        expect(select((s: { count: number }) => s.count)(session)).toBe(10)
    })

    it('passes mount options through for keyed resuscitation', async () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        const bp = createContext({ count: 5 })

        const first = await mountAsync(bp, { key: 'async-panel' })(el1)
        const revived = await mountAsync(bp, { key: 'async-panel' })(el2)

        expect(revived).toBe(first)
        expect(revived.target).toBe(el2)
        expect(select((s: { count: number }) => s.count)(revived)).toBe(5)
    })

    it('mounts async providers lazily without blocking', async () => {
        const el = document.createElement('div')
        const bp = withAsyncProvider(
            'remote:config',
            async () => ({ ready: true }),
            {}
        )(createContext({}))

        const session = await mountAsync(bp)(el)
        expect(session).toBeDefined()
    })
})
