import { describe, expect, it } from 'vitest'
import { CONTEXT_REQUEST_EVENT, ContextRequestEvent } from './events'

describe('ContextRequestEvent', () => {
    it('creates a standard W3C context-request event with correct options', () => {
        let callbackCalled = false
        const callback = (val: unknown) => {
            callbackCalled = true
        }

        const event = new ContextRequestEvent('theme:mode', callback, {
            subscribe: true,
            multi: false
        })

        expect(event.type).toBe(CONTEXT_REQUEST_EVENT)
        expect(event.type).toBe('context-request')
        expect(event.bubbles).toBe(true)
        expect(event.composed).toBe(true)
        expect(event.cancelable).toBe(true)
        expect(event.detail.context).toBe('theme:mode')
        expect(event.detail.subscribe).toBe(true)
        expect(event.detail.multi).toBe(false)

        event.detail.callback('dark')
        expect(callbackCalled).toBe(true)
    })

    it('defaults subscribe and multi to false', () => {
        const event = new ContextRequestEvent('auth:token', () => {})

        expect(event.detail.subscribe).toBe(false)
        expect(event.detail.multi).toBe(false)
    })
})
