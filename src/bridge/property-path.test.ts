import { describe, expect, it } from 'vitest'
import { readDomProperty, writeDomProperty } from './property-path'
import { PropertySyncSecurityError } from '../core/errors'

describe('property-path accessor & dot-path engine', () => {
    it('reads and writes dataset properties', () => {
        const el = document.createElement('div')
        writeDomProperty(el, 'dataset.theme', 'dark')

        expect(el.dataset.theme).toBe('dark')
        expect(readDomProperty(el, 'dataset.theme')).toBe('dark')
    })

    it('reads and writes inline styles and CSS variables', () => {
        const el = document.createElement('div')
        writeDomProperty(el, 'style.color', 'red')
        writeDomProperty(el, 'style.--primary-color', '#ff0000')

        expect(el.style.color).toBe('red')
        expect(readDomProperty(el, 'style.color')).toBe('red')
        expect(readDomProperty(el, 'style.--primary-color')).toBe('#ff0000')
    })

    it('reads and writes aria boolean attributes', () => {
        const el = document.createElement('div')
        writeDomProperty(el, 'aria-expanded', true)

        expect(el.getAttribute('aria-expanded')).toBe('true')
        expect(readDomProperty(el, 'aria-expanded')).toBe('true')

        writeDomProperty(el, 'aria-expanded', false)
        expect(el.getAttribute('aria-expanded')).toBe('false')
    })

    it('handles Form-Associated Custom Elements via elementInternals.value', () => {
        const el = document.createElement('div')
        let formValue: any
        ;(el as any)._internals = {
            setFormValue(v: any) {
                formValue = v
            },
            get formValue() {
                return formValue
            }
        }

        writeDomProperty(el, 'elementInternals.value', 'custom-input-val')
        expect(formValue).toBe('custom-input-val')
        expect(readDomProperty(el, 'elementInternals.value')).toBe('custom-input-val')
    })

    it('handles HTML boolean attributes such as hidden correctly', () => {
        const el = document.createElement('div')
        writeDomProperty(el, 'hidden', true)

        expect(el.hasAttribute('hidden')).toBe(true)
        expect(readDomProperty(el, 'hidden')).toBe(true)

        writeDomProperty(el, 'hidden', false)
        expect(el.hasAttribute('hidden')).toBe(false)
        expect(readDomProperty(el, 'hidden')).toBe(false)
    })

    it('blocks dangerous sinks and prototype pollution paths', () => {
        const el = document.createElement('div')

        expect(() => {
            writeDomProperty(el, '__proto__.polluted', 'hack')
        }).toThrow(PropertySyncSecurityError)

        expect(() => {
            writeDomProperty(el, 'innerHTML', '<script>alert(1)</script>')
        }).toThrow(PropertySyncSecurityError)
    })
})
