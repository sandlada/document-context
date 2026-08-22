import { describe, expect, it } from 'vitest'
import {
    validatePropertyPath,
    parseBoolean,
    parseNumber,
    parseJSON
} from './sanitize'
import { PropertySyncSecurityError } from '../core/errors'

describe('Bridge Sanitize & Security', () => {
    it('blocks prototype pollution paths and throws PropertySyncSecurityError', () => {
        const dangerousPaths = [
            '__proto__',
            '__proto__.polluted',
            'constructor',
            'constructor.prototype',
            'prototype',
            'nested.prototype.danger'
        ]

        for (const path of dangerousPaths) {
            expect(() => {
                validatePropertyPath(path)
            }).toThrow(PropertySyncSecurityError)
        }
    })

    it('rejects dangerous DOM XSS sinks and throws PropertySyncSecurityError', () => {
        const xssSinks = [
            'innerHTML',
            'outerHTML',
            'insertAdjacentHTML',
            'srcdoc',
            'script',
            'eval'
        ]

        for (const sink of xssSinks) {
            expect(() => {
                validatePropertyPath(sink)
            }).toThrow(PropertySyncSecurityError)
        }
    })

    it('allows valid safe property paths', () => {
        const safePaths = [
            'dataset.theme',
            'style.color',
            'style.--brand-color',
            'aria-expanded',
            'aria-hidden',
            'value',
            'checked',
            'disabled',
            'id',
            'lang',
            'title',
            'hidden'
        ]

        for (const path of safePaths) {
            expect(() => {
                validatePropertyPath(path)
            }).not.toThrow()
        }
    })

    it('provides type-fidelity parsers for Boolean, Number, and JSON', () => {
        expect(parseBoolean('true')).toBe(true)
        expect(parseBoolean('false')).toBe(false)
        expect(parseBoolean('')).toBe(false)
        expect(parseBoolean(null as any)).toBe(false)
        expect(parseBoolean(true as any)).toBe(true)

        expect(parseNumber('42')).toBe(42)
        expect(parseNumber('3.14')).toBe(3.14)
        expect(parseNumber('invalid')).toBe(NaN)

        expect(parseJSON('{"name":"Alice","age":30}')).toEqual({
            name: 'Alice',
            age: 30
        })
        expect(parseJSON('[1,2,3]')).toEqual([1, 2, 3])
        expect(parseJSON('invalid-json')).toBe('invalid-json')
    })
})
