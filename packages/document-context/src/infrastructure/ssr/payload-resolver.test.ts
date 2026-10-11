/**
 * Tests for the SSR payload resolver.
 *
 * The resolver reads server-rendered JSON payloads by exact id. It must never
 * use `querySelector`: token suffixes contain `:` (the namespace separator),
 * which CSS would parse as pseudo-classes, so only `getElementById` is
 * exact, colon-safe, and fast.
 */
import { describe, expect, it } from 'vitest'
import { createPayloadResolver, payloadIdFor } from './payload-resolver.js'

interface FakeElement {
    readonly textContent: string | null
}

/**
 * Minimal document double exposing only `getElementById`.
 *
 * @param entries Id-to-content mapping backing the double.
 * @returns A document double serving the entries.
 */
function fakeDocument(entries: Record<string, string | null> = {}): { getElementById(id: string): FakeElement | null } {
    return {
        getElementById(id: string): FakeElement | null {
            if (Object.prototype.hasOwnProperty.call(entries, id) === false) {
                return null
            }
            return { textContent: entries[id] ?? null }
        },
    }
}

describe('payloadIdFor', () => {
    it('maps a null token to the anonymous payload id', () => {
        expect(payloadIdFor(null)).toBe('__dc_state')
    })

    it('suffixes keyed payload ids with the token verbatim (colons intact)', () => {
        expect(payloadIdFor('app:cart')).toBe('__dc_state:app:cart')
    })
})

describe('createPayloadResolver', () => {
    it('reads and parses the keyed payload', () => {
        const resolve = createPayloadResolver(fakeDocument({ '__dc_state:app:cart': '{"count":2}' }))
        expect(resolve('app:cart')).toEqual({ count: 2 })
    })

    it('reads the anonymous payload for a null token', () => {
        const resolve = createPayloadResolver(fakeDocument({ '__dc_state': '{"count":1}' }))
        expect(resolve(null)).toEqual({ count: 1 })
    })

    it('returns non-object payloads as-is', () => {
        const resolve = createPayloadResolver(fakeDocument({ '__dc_state': '[1,2]' }))
        expect(resolve(null)).toEqual([1, 2])
    })

    it('degrades to null on missing elements, empty text, and corrupt JSON', () => {
        const resolve = createPayloadResolver(fakeDocument({
            '__dc_state:app:empty': '',
            '__dc_state:app:broken': '{oops',
        }))
        expect(resolve('app:missing')).toBeNull()
        expect(resolve('app:empty')).toBeNull()
        expect(resolve('app:broken')).toBeNull()
    })

    it('degrades to null when the document itself throws', () => {
        const resolve = createPayloadResolver({
            getElementById(): FakeElement | null {
                throw new Error('document gone')
            },
        })
        expect(resolve('app:cart')).toBeNull()
    })

    it('never touches querySelector, even when present and hostile', () => {
        const hostile = {
            getElementById(id: string): FakeElement | null {
                return id === '__dc_state:app:cart' ? { textContent: '{"count":9}' } : null
            },
            querySelector(): FakeElement | null {
                throw new Error('querySelector must not be used')
            },
        }
        const resolve = createPayloadResolver(hostile as unknown as { getElementById(id: string): FakeElement | null })
        expect(resolve('app:cart')).toEqual({ count: 9 })
    })
})
