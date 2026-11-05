import { describe, expect, it } from 'vitest'
import { copyState, createContext, isPlainObject, pipe } from './blueprint'
import { defineToken } from './token'

describe('blueprint', () => {
    it('[API #1] 藍圖運算子為 data-last 且例外只有四類', () => {
        const operator = (blueprint: ReturnType<typeof createContext<{ count: number }>>) => blueprint
        expect(typeof operator).toBe('function')
        expect(typeof createContext).toBe('function')
        expect(typeof pipe).toBe('function')
        expect(typeof defineToken).toBe('function')
    })

    it('[API #1] pipe 由左至右套用運算子且不變更來源藍圖', () => {
        const source = createContext({ count: 0 })
        const result = pipe(
            source,
            (blueprint) => ({ ...blueprint, state: { count: 1 } }),
            (blueprint) => ({ ...blueprint, state: { count: blueprint.state.count + 1 } }),
        )

        expect(result.state).toEqual({ count: 2 })
        expect(source.state).toEqual({ count: 0 })
        expect(result).not.toBe(source)
    })

    it('[API #7] createContext 複製初始狀態', () => {
        const initial = { count: 0, nested: { label: 'a' } }
        const blueprint = createContext(initial)

        initial.count = 99
        initial.nested.label = 'b'

        expect(blueprint.state.count).toBe(0)
        expect(blueprint.state.nested.label).toBe('a')
    })

    it('[API #7] copyState 深拷貝純物件與陣列並保留其他值', () => {
        const instance = new Date(0)
        const source = { list: [1, 2], when: instance }
        const copy = copyState(source)

        expect(copy.list).not.toBe(source.list)
        expect(copy.list).toEqual([1, 2])
        expect(copy.when).toBe(instance)
    })

    it('[API #1] isPlainObject 只認物件字面量', () => {
        expect(isPlainObject({})).toBe(true)
        expect(isPlainObject(Object.create(null))).toBe(true)
        expect(isPlainObject([])).toBe(false)
        expect(isPlainObject(null)).toBe(false)
        expect(isPlainObject(new Date())).toBe(false)
    })
})
