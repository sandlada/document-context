import { describe, expect, it } from 'vitest'
import { applyKeyProjection, resolveSessionKey } from './session-key'

describe('session-key', () => {
    it('resolves the explicit option key over the attribute', () => {
        const el = document.createElement('div')
        el.setAttribute('data-context-key', 'attr-key')

        expect(resolveSessionKey(el, 'option-key')).toBe('option-key')
    })

    it('falls back to the attribute and trims whitespace', () => {
        const el = document.createElement('div')
        el.setAttribute('data-context-key', '  cart-panel  ')

        expect(resolveSessionKey(el)).toBe('cart-panel')
    })

    it('treats empty or whitespace-only keys as anonymous', () => {
        const el = document.createElement('div')

        expect(resolveSessionKey(el)).toBeUndefined()

        el.setAttribute('data-context-key', '   ')
        expect(resolveSessionKey(el)).toBeUndefined()

        expect(resolveSessionKey(el, '')).toBeUndefined()
    })

    it('writes the resolved key back to the element attribute', () => {
        const el = document.createElement('div')

        applyKeyProjection(el, 'hero-widget')
        expect(el.getAttribute('data-context-key')).toBe('hero-widget')

        applyKeyProjection(el, 'another-key')
        expect(el.getAttribute('data-context-key')).toBe('another-key')
    })

    it('does not touch the attribute for anonymous sessions', () => {
        const el = document.createElement('div')
        el.setAttribute('data-context-key', 'existing')

        applyKeyProjection(el, undefined)
        expect(el.getAttribute('data-context-key')).toBe('existing')
    })
})
