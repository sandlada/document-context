/**
 * Tests for SSR state serialization.
 *
 * `serializeState` is pure and DOM-free: it stringifies a state snapshot (or
 * a selected subset) and escapes every character that could break out of a
 * `<script type="application/json">` embed.
 */
import { describe, expect, it } from 'vitest'
import { BehaviorSubject, NEVER } from 'rxjs'
import type { Observable } from 'rxjs'
import { serialize, serializeState } from './serialize.js'

const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)

describe('serializeState', () => {
    it('stringifies the full state by default', () => {
        expect(serializeState({ count: 1, theme: 'light' })).toBe('{"count":1,"theme":"light"}')
    })

    it('stringifies only the selected subset when select is given', () => {
        const state = { count: 3, secret: 'hidden' }
        expect(serializeState(state, (current) => ({ count: current.count }))).toBe('{"count":3}')
    })

    it('escapes angle brackets, ampersands, and line separators as \\uXXXX', () => {
        const output = serializeState({ html: '</script> & <b>' + LS + PS + 'end' })
        expect(output).toBe('{"html":"\\u003c/script\\u003e \\u0026 \\u003cb\\u003e\\u2028\\u2029end"}')
        expect(output.includes('<')).toBe(false)
        expect(output.includes('>')).toBe(false)
        expect(output.includes('&')).toBe(false)
        expect(output.includes(LS)).toBe(false)
        expect(output.includes(PS)).toBe(false)
    })

    it('round-trips through JSON.parse to the original value', () => {
        const state = { html: '<b>&amp;</b>' + LS, count: 7 }
        expect(JSON.parse(serializeState(state)) as unknown).toEqual(state)
    })

    it('never mutates (or requires mutability of) its input', () => {
        const state = Object.freeze({ count: 1, nested: Object.freeze({ tag: '<x>' }) })
        expect(() => serializeState(state)).not.toThrow()
        expect(state).toEqual({ count: 1, nested: { tag: '<x>' } })
    })

    it('serializes an undefined selection as null', () => {
        expect(serializeState({ count: 1 }, () => undefined)).toBe('null')
    })

    it('lets circular structures throw the natural JSON TypeError', () => {
        const cyclic: Record<string, unknown> = { count: 1 }
        cyclic['self'] = cyclic
        expect(() => serializeState(cyclic)).toThrowError(TypeError)
    })
})

describe('serialize', () => {
    it('serializes the current session snapshot', () => {
        const state$ = new BehaviorSubject({ count: 4, theme: 'dark' })
        expect(serialize()({ state$ })).toBe('{"count":4,"theme":"dark"}')
    })

    it('applies select before escaping', () => {
        const state$ = new BehaviorSubject({ count: 4, html: '<b>hi</b>' })
        const output = serialize<{ count: number, html: string }>({ select: (current) => ({ count: current.count }) })({ state$ })
        expect(output).toBe('{"count":4}')
    })

    it('throws a clear error when state$ never emits synchronously', () => {
        const state$ = NEVER as unknown as Observable<{ readonly count: number }>
        expect(() => serialize()({ state$ })).toThrowError(/synchronously/)
    })
})
