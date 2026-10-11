import { describe, expect, it } from 'vitest'
import type { ContextBlueprint } from '../../domain/model/blueprint.js'
import { createContext } from './create-context.js'
import { pipe } from './pipe.js'

describe('pipe', () => {
    it('returns the input blueprint unchanged when no operators are given', () => {
        const blueprint = createContext({ count: 0 })
        expect(pipe(blueprint)).toBe(blueprint)
    })

    it('applies a single operator to the blueprint', () => {
        const blueprint = createContext({ count: 0 })
        const tagged = pipe(blueprint, (bp) => ({ ...bp, storage: null }))
        expect(tagged.initial).toBe(blueprint.initial)
        expect(tagged).not.toBe(blueprint)
    })

    it('folds operators left to right in order', () => {
        const blueprint = createContext({ count: 0 })
        const seen: Array<string> = []
        const tag = (name: string) => (bp: ContextBlueprint<{ count: number }>): ContextBlueprint<{ count: number }> => {
            seen.push(name)
            return { ...bp }
        }
        pipe(blueprint, tag('first'), tag('second'), tag('third'))
        expect(seen).toEqual(['first', 'second', 'third'])
    })

    it('feeds each operator the previous operator output', () => {
        const blueprint = createContext({ count: 0 })
        const addHook = (bp: ContextBlueprint<{ count: number }>): ContextBlueprint<{ count: number }> => ({
            ...bp,
            hooks: [...bp.hooks, { event: 'mount', handler: () => undefined }],
        })
        const observed: Array<number> = []
        const observe = (bp: ContextBlueprint<{ count: number }>): ContextBlueprint<{ count: number }> => {
            observed.push(bp.hooks.length)
            return bp
        }
        const result = pipe(blueprint, addHook, observe)
        expect(observed).toEqual([1])
        expect(result.hooks).toHaveLength(1)
    })

    it('returns the final operator output without mutating the input', () => {
        const blueprint = createContext({ count: 0 })
        const result = pipe(blueprint, (bp) => ({ ...bp, hooks: [...bp.hooks, { event: 'mount', handler: () => undefined }] }))
        expect(result).not.toBe(blueprint)
        expect(blueprint.hooks).toEqual([])
        expect(blueprint.providers.size).toBe(0)
        expect(result.hooks).toHaveLength(1)
    })

    it('keeps the state type across composition', () => {
        const blueprint = createContext({ count: 0 })
        const result = pipe(blueprint, (bp) => bp)
        expect(result.initial).toEqual({ count: 0 })
    })
})
