import { describe, expect, it } from 'vitest'
import { DocumentContextError } from './errors.js'
import { isTerminal, transition } from './lifecycle.js'
import type { SessionKind, SessionStatus, SessionTransitionEvent } from './lifecycle.js'

describe('transition', () => {
    it('moves blueprint to initializing on mount for both kinds', () => {
        expect(transition('blueprint', 'mount', 'anonymous')).toBe('initializing')
        expect(transition('blueprint', 'mount', 'keyed')).toBe('initializing')
    })

    it('moves initializing to mounted on ready', () => {
        expect(transition('initializing', 'ready', 'anonymous')).toBe('mounted')
        expect(transition('initializing', 'ready', 'keyed')).toBe('mounted')
    })

    it('suspends keyed sessions but disposes anonymous ones on wait-disconnect', () => {
        expect(transition('initializing', 'wait-disconnect', 'keyed')).toBe('suspended')
        expect(transition('initializing', 'wait-disconnect', 'anonymous')).toBe('disposed')
    })

    it('moves initializing to disposed on abort for both kinds', () => {
        expect(transition('initializing', 'abort', 'anonymous')).toBe('disposed')
        expect(transition('initializing', 'abort', 'keyed')).toBe('disposed')
    })

    it('suspends keyed sessions but disposes anonymous ones on disconnect', () => {
        expect(transition('mounted', 'disconnect', 'keyed')).toBe('suspended')
        expect(transition('mounted', 'disconnect', 'anonymous')).toBe('disposed')
    })

    it('moves mounted to disposed on dispose for both kinds', () => {
        expect(transition('mounted', 'dispose', 'anonymous')).toBe('disposed')
        expect(transition('mounted', 'dispose', 'keyed')).toBe('disposed')
    })

    it('moves suspended to mounted on resuscitate', () => {
        expect(transition('suspended', 'resuscitate', 'keyed')).toBe('mounted')
    })

    it('moves suspended to disposed on ttl or dispose', () => {
        expect(transition('suspended', 'ttl', 'keyed')).toBe('disposed')
        expect(transition('suspended', 'dispose', 'keyed')).toBe('disposed')
    })

    it('rejects every illegal transition with a plain Error carrying no invented code', () => {
        const illegal: Array<[SessionStatus, SessionTransitionEvent, SessionKind]> = [
            ['blueprint', 'ready', 'anonymous'],
            ['blueprint', 'dispose', 'keyed'],
            ['blueprint', 'resuscitate', 'keyed'],
            ['initializing', 'mount', 'anonymous'],
            ['initializing', 'resuscitate', 'keyed'],
            ['initializing', 'disconnect', 'keyed'],
            ['mounted', 'mount', 'anonymous'],
            ['mounted', 'ready', 'keyed'],
            ['mounted', 'resuscitate', 'keyed'],
            ['suspended', 'mount', 'keyed'],
            ['suspended', 'ready', 'keyed'],
            ['suspended', 'disconnect', 'keyed'],
            ['suspended', 'wait-disconnect', 'keyed'],
            ['disposed', 'mount', 'anonymous'],
            ['disposed', 'resuscitate', 'keyed'],
            ['disposed', 'dispose', 'anonymous'],
            ['disposed', 'ttl', 'keyed'],
        ]
        for (const [status, event, kind] of illegal) {
            try {
                transition(status, event, kind)
                throw new Error(`expected illegal transition ${status} + ${event} to throw`)
            } catch (error) {
                expect(error).toBeInstanceOf(Error)
                expect(error).not.toBeInstanceOf(DocumentContextError)
                expect((error as Error).message).toContain(status)
                expect((error as Error).message).toContain(event)
            }
        }
    })
})

describe('isTerminal', () => {
    it('reports only disposed as terminal', () => {
        const statuses: Array<SessionStatus> = ['blueprint', 'initializing', 'mounted', 'suspended', 'disposed']
        expect(statuses.map((status) => isTerminal(status))).toEqual([false, false, false, false, true])
    })
})
