import { describe, expect, it } from 'vitest'
import {
    defineToken,
    isPrivateToken,
    isPublicToken,
    validateTokenName,
} from './token'
import { DocumentContextError } from './errors'

describe('token', () => {
    it('[API #12] defineToken 冪等且 runtime 為字串', () => {
        const first = defineToken<'dark' | 'light'>('public')('app:theme')
        const second = defineToken<'dark' | 'light'>()('app:theme')

        expect(typeof first).toBe('string')
        expect(first).toBe('app:theme')
        expect(first).toBe(second)
    })

    it('[API #12] 省略可見性時等同 public', () => {
        expect(defineToken<string>()('app:theme')).toBe(
            defineToken<string>('public')('app:theme'),
        )
    })

    it('[API #12] 私有 token 以引用辨識', () => {
        const first = defineToken<string>('private')('internal:secret')
        const second = defineToken<string>('private')('internal:secret')

        expect(first).not.toBe(second)
        expect(isPrivateToken(first)).toBe(true)
        expect(isPublicToken(first)).toBe(false)
    })

    it('[API #13] 非法公開名以 TOKEN_INVALID 拒絕', () => {
        expect(() => defineToken<string>()('no-namespace')).toThrowError(DocumentContextError)
        try {
            defineToken<string>()('no-namespace')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('TOKEN_INVALID')
        }
    })

    it('[API #13] 私有 token 不走名稱驗證', () => {
        const token = defineToken<string>('private')('no-namespace')
        expect(token.name).toBe('no-namespace')
    })

    it('[SCOPE #11] validateTokenName 接受 namespace:name', () => {
        expect(() => validateTokenName('app:theme')).not.toThrow()
        expect(() => validateTokenName('vendor.theme:dark-mode')).not.toThrow()
        expect(() => validateTokenName('app:')).toThrow()
        expect(() => validateTokenName(':theme')).toThrow()
        expect(() => validateTokenName('a:b:c')).toThrow()
    })
})
