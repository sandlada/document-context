import { describe, expect, it } from 'vitest'
import { merge } from './merge'

describe('merge', () => {
    it('[API #6] merge 遞迴合併且不刪鍵', () => {
        const result = merge(
            { a: 1, nested: { c: 2, d: 3 } },
            { nested: { d: 4, e: 5 } },
        )

        expect(result).toEqual({ a: 1, nested: { c: 2, d: 4, e: 5 } })
    })

    it('[API #6] merge 不改變來源物件', () => {
        const nested = { value: 1 }
        const base = { nested, list: [1] }
        const result = merge(base, { extra: true })

        expect(base.nested.value).toBe(1)
        expect(result.nested).not.toBe(nested)
        result.nested.value = 9
        expect(base.nested.value).toBe(1)
        expect(result.list).toBe(base.list)
    })

    it('[API #6] merge 保留 Object.create(null) 的原型', () => {
        const base = Object.create(null) as { count: number }
        base.count = 1
        const result = merge(base, { extra: true })

        expect(Object.getPrototypeOf(result)).toBe(null)
        expect(result).toEqual({ count: 1, extra: true })
    })

    it('[API #6] 陣列、null 與日期整顆替換', () => {
        const when = new Date(0)
        expect(merge({ list: [1, 2] }, { list: [3] })).toEqual({ list: [3] })
        expect(merge({ value: 1 }, { value: null })).toEqual({ value: null })
        expect(merge({ when: new Date(1) }, { when })).toEqual({ when })
    })

    it('[API #6] 不合併 __proto__、constructor 與 prototype', () => {
        const result = merge(
            { safe: true },
            JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>,
        )

        expect(result).toEqual({ safe: true })
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    })

    it('[API #6] merge 遇循環引用拋錯', () => {
        const cyclic: Record<string, unknown> = {}
        cyclic['self'] = cyclic

        expect(() => merge({}, cyclic)).toThrow(/circular/i)
    })
})
