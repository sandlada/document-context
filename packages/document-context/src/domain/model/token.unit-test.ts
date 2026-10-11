import { describe, expect, it } from 'vitest'
import { DocumentContextError } from './errors.js'
import { definePrivateToken, defineToken, validateTokenName } from './token.js'
import type { Token } from './token.js'

interface User {
    readonly id: string
}

const VALID_TOKENS: ReadonlyArray<string> = [
    'app:user',
    'a:b',
    'a:b:c:d',
    'my.org:app-1/x_y.z:w',
    'A1:x-9.y_z/w',
    'app:__PROTO__',
    'app:__system__',
    `ok:${'x'.repeat(253)}`,
]

const INVALID_TOKENS: ReadonlyArray<readonly [string, string]> = [
    ['', 'empty'],
    ['plain', 'missing-namespace'],
    ['__system__', 'missing-namespace'],
    [':a', 'empty-segment'],
    ['a:', 'empty-segment'],
    [':', 'empty-segment'],
    ['a::b', 'empty-segment'],
    ['app:us er', 'invalid-charset'],
    ['app:us"er', 'invalid-charset'],
    ['app:<user>', 'invalid-charset'],
    ['app:user&x', 'invalid-charset'],
    ['app:user@x', 'invalid-charset'],
    ['app:user#x', 'invalid-charset'],
    ['app:user!x', 'invalid-charset'],
    ['app:üser', 'invalid-charset'],
    [`xx:${'y'.repeat(254)}`, 'too-long'],
    ['__proto__:a', 'blacklisted-segment'],
    ['a:prototype', 'blacklisted-segment'],
    ['a:b:constructor', 'blacklisted-segment'],
    ['constructor:x', 'blacklisted-segment'],
    ['__system__:app', 'reserved-namespace'],
    ['__document-context__:app', 'reserved-namespace'],
]

function reasonFor(name: string): unknown {
    try {
        defineToken(name)
    } catch (error) {
        expect(error).toBeInstanceOf(DocumentContextError)
        const documentError = error as DocumentContextError
        expect(documentError.code).toBe('TOKEN_INVALID')
        expect(documentError.details['token']).toBe(name)
        return documentError.details['reason']
    }
    throw new Error(`Expected TOKEN_INVALID for token ${name}`)
}

describe('defineToken', () => {
    it('returns the name as a runtime string', () => {
        const token = defineToken<User>('app:user')
        expect(typeof token).toBe('string')
        expect(token).toBe('app:user')
        const asString: string = token
        expect(asString).toBe('app:user')
    })

    it('is pure and idempotent for the same name', () => {
        expect(defineToken('app:user')).toBe(defineToken('app:user'))
        expect(defineToken<User>('app:user')).toBe(defineToken<User>('app:user'))
    })

    it('accepts valid namespaced names', () => {
        for (const name of VALID_TOKENS) {
            expect(defineToken(name)).toBe(name)
        }
    })

    it('rejects every invalid shape with TOKEN_INVALID and a reason', () => {
        for (const [name, reason] of INVALID_TOKENS) {
            expect(reasonFor(name)).toBe(reason)
        }
    })

    it('rejects non-string input at runtime', () => {
        expect(reasonFor(42 as unknown as string)).toBe('not-a-string')
    })
})

describe('validateTokenName', () => {
    it('is the single source of truth shared with defineToken', () => {
        for (const name of VALID_TOKENS) {
            expect(validateTokenName(name)).toBeUndefined()
        }
        for (const [name, reason] of INVALID_TOKENS) {
            try {
                validateTokenName(name)
            } catch (error) {
                expect(error).toBeInstanceOf(DocumentContextError)
                const documentError = error as DocumentContextError
                expect(documentError.code).toBe('TOKEN_INVALID')
                expect(documentError.details).toEqual({ token: name, reason })
                continue
            }
            throw new Error(`Expected TOKEN_INVALID for token ${name}`)
        }
    })

    it('validates the bare-string escape hatch identically', () => {
        expect(validateTokenName('app:raw')).toBeUndefined()
        expect(reasonFor('raw')).toBe('missing-namespace')
    })
})

describe('definePrivateToken', () => {
    it('returns a frozen object carrying the debug name', () => {
        const secret = definePrivateToken('app:session-secret')
        expect(typeof secret).toBe('object')
        expect(secret.name).toBe('app:session-secret')
        expect(Object.isFrozen(secret)).toBe(true)
    })

    it('uses reference equality: same name yields distinct tokens', () => {
        const first = definePrivateToken('app:secret')
        const second = definePrivateToken('app:secret')
        expect(first).not.toBe(second)
    })

    it('exempts the debug name from namespace validation', () => {
        const exempt = ['', 'plain', '__proto__:evil', '__system__:evil', 'has space', 'a"b<c>d&e']
        for (const name of exempt) {
            expect(definePrivateToken(name).name).toBe(name)
        }
    })
})

describe('token equivalence', () => {
    it('treats public tokens by string equality and private tokens by reference', () => {
        const registry = new Map<unknown, string>()
        registry.set(defineToken('app:shared'), 'first')
        registry.set(defineToken('app:shared'), 'second')
        expect(registry.size).toBe(1)
        expect(registry.get('app:shared')).toBe('second')

        const first = definePrivateToken('app:secret')
        const second = definePrivateToken('app:secret')
        registry.set(first, 'p1')
        registry.set(second, 'p2')
        expect(registry.size).toBe(3)
    })

    it('accepts every token form in the Token union', () => {
        const tokens: ReadonlyArray<Token> = [
            defineToken('app:a'),
            definePrivateToken('app:b'),
            'app:c',
        ]
        expect(tokens).toHaveLength(3)
    })
})
