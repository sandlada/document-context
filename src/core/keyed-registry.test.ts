import { describe, expect, it } from 'vitest'
import type { ISession } from './types'
import {
    lookupKeyedSession,
    registerKeyedSession,
    unregisterKeyedSessionEntry
} from './keyed-registry'

function fakeSession(tag: string): ISession<any, any> {
    return { tag } as unknown as ISession<any, any>
}

describe('keyed-registry', () => {
    it('registers and looks up a keyed session within its document', () => {
        const doc = document.implementation.createHTMLDocument('registry-a')
        const session = fakeSession('a')

        registerKeyedSession(doc, 'cart', session)

        expect(lookupKeyedSession(doc, 'cart')).toBe(session)
    })

    it('isolates registries per document', () => {
        const docA = document.implementation.createHTMLDocument('registry-b1')
        const docB = document.implementation.createHTMLDocument('registry-b2')
        const session = fakeSession('b')

        registerKeyedSession(docA, 'shared-key', session)

        expect(lookupKeyedSession(docB, 'shared-key')).toBeUndefined()
        expect(lookupKeyedSession(docB, 'shared-key')).toBeUndefined()
        expect(lookupKeyedSession(docA, 'shared-key')).toBe(session)
    })

    it('unregisters entries only when the recorded session matches', () => {
        const doc = document.implementation.createHTMLDocument('registry-c')
        const first = fakeSession('first')
        const second = fakeSession('second')
        registerKeyedSession(doc, 'key', first)

        unregisterKeyedSessionEntry(doc, 'key', second)
        expect(lookupKeyedSession(doc, 'key')).toBe(first)

        unregisterKeyedSessionEntry(doc, 'key', first)
        expect(lookupKeyedSession(doc, 'key')).toBeUndefined()
    })

    it('replaces the previous entry when registering under the same key', () => {
        const doc = document.implementation.createHTMLDocument('registry-d')
        const first = fakeSession('first')
        const second = fakeSession('second')

        registerKeyedSession(doc, 'key', first)
        registerKeyedSession(doc, 'key', second)

        expect(lookupKeyedSession(doc, 'key')).toBe(second)
    })
})
