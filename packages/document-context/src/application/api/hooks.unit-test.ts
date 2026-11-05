import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../domain/model/blueprint'
import { onAdopt, onDispose, onMount, onResume, onSuspend } from './hooks'

describe('hook operators', () => {
    it('[LC #8] 每個鉤子都是純藍圖運算子', () => {
        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(() => undefined),
            onSuspend(() => undefined),
            onResume(() => undefined),
            onAdopt(() => undefined),
            onDispose(() => undefined),
        )

        expect(blueprint.hooks.map((hook) => hook.type)).toEqual([
            'mount',
            'suspend',
            'resume',
            'adopt',
            'dispose',
        ])
    })

    it('[LC #8] 鉤子註冊順序被保留', () => {
        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(() => undefined),
            onMount(() => undefined),
        )

        expect(blueprint.hooks.map((hook) => hook.order)).toEqual([0, 1])
    })

    it('[API #1] 鉤子運算子不回傳 void 且不改變來源藍圖', () => {
        const source = createContext({ count: 0 })
        const operator = onMount(() => undefined)
        const result = operator(source)

        expect(result).not.toBe(source)
        expect(source.hooks).toHaveLength(0)
    })
})
