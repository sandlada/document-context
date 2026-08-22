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
})
