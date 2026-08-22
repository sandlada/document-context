import { describe, expect, it } from 'vitest'
import { createContext } from './context'
import { pipe } from './pipe'
import type { IContextBlueprint } from './types'

describe('pipe', () => {
    it('returns source blueprint if no operators are passed', () => {
        const bp = createContext({ count: 0 })
        const result = pipe(bp)
        expect(result).toBe(bp)
    })

    it('applies a single operator correctly', () => {
        const bp = createContext({ count: 0 })
        const dummyOp = (b: IContextBlueprint<{ count: number }, {}>) => ({
            ...b,
            bridges: [{ properties: { count: 'dataset.count' } }]
        })

        const result = pipe(bp, dummyOp)
        expect(result.bridges.length).toBe(1)
        expect(result.initialState).toEqual({ count: 0 })
    })

    it('composes multiple operators in sequential order (FIFO)', () => {
        const bp = createContext({ val: '' })
        const executionOrder: string[] = []

        const op1 = (b: IContextBlueprint<{ val: string }, {}>) => {
            executionOrder.push('op1')
            return {
                ...b,
                initialState: { val: b.initialState.val + 'A' }
            }
        }

        const op2 = (b: typeof bp) => {
            executionOrder.push('op2')
            return {
                ...b,
                initialState: { val: b.initialState.val + 'B' }
            }
        }

        const op3 = (b: typeof bp) => {
            executionOrder.push('op3')
            return {
                ...b,
                initialState: { val: b.initialState.val + 'C' }
            }
        }

        const result = pipe(bp, op1, op2, op3)
        expect(executionOrder).toEqual(['op1', 'op2', 'op3'])
        expect(result.initialState.val).toBe('ABC')
    })

    it('supports 10+ operator overloads without breaking type inference', () => {
        const bp = createContext({ count: 0 })
        const addOne = (b: typeof bp) => ({
            ...b,
            initialState: { count: b.initialState.count + 1 }
        })

        const result = pipe(
            bp,
            addOne,
            addOne,
            addOne,
            addOne,
            addOne,
            addOne,
            addOne,
            addOne,
            addOne,
            addOne
        )

        expect(result.initialState.count).toBe(10)
    })
})
