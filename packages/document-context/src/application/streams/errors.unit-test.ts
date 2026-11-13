import { describe, expect, it } from 'vitest'
import { DocumentContextError } from '../../domain/model/errors'
import { createErrorStream, ERROR_BUFFER_LIMIT } from './errors'

describe('error stream', () => {
    it('[RX #4] 初始化期錯誤被緩衝直到第一次訂閱', () => {
        const stream = createErrorStream()
        stream.push(new DocumentContextError('HOOK_ERROR', 'buffered'))

        const seen: string[] = []
        stream.observable.subscribe((error) => seen.push(error.message))

        expect(seen).toEqual(['buffered'])
    })

    it('[RX #4] 排空緩衝時重入的錯誤不會遺失', () => {
        const stream = createErrorStream()
        stream.push(new DocumentContextError('HOOK_ERROR', 'buffered'))

        const seen: string[] = []
        stream.observable.subscribe((error) => {
            seen.push(error.message)
            if (error.message === 'buffered') {
                stream.push(new DocumentContextError('HOOK_ERROR', 'reentered'))
            }
        })

        expect(seen).toEqual(['buffered', 'reentered'])
    })

    it('[RX #4] 第二個訂閱者只收到新事件', () => {
        const stream = createErrorStream()
        stream.push(new DocumentContextError('HOOK_ERROR', 'buffered'))

        const first: string[] = []
        stream.observable.subscribe((error) => first.push(error.message))

        stream.push(new DocumentContextError('HOOK_ERROR', 'live'))

        const second: string[] = []
        stream.observable.subscribe((error) => second.push(error.message))

        expect(first).toEqual(['buffered', 'live'])
        expect(second).toEqual([])
    })

    it('[RX #4] 緩衝上限 32 且首訂排空附記賬', () => {
        const stream = createErrorStream()
        for (let index = 0; index < ERROR_BUFFER_LIMIT + 5; index += 1) {
            stream.push(new DocumentContextError('HOOK_ERROR', `error-${index}`))
        }

        const seen: DocumentContextError[] = []
        stream.observable.subscribe((error) => seen.push(error))

        expect(seen).toHaveLength(ERROR_BUFFER_LIMIT)
        expect(seen[0]?.message).toBe('error-5')
        expect(seen[seen.length - 1]?.dropped).toBe(5)
    })

    it('[RX #4] errors$ 永不以錯誤結束', () => {
        const stream = createErrorStream()
        let failed = false
        let completed = false
        stream.observable.subscribe({
            error: () => {
                failed = true
            },
            complete: () => {
                completed = true
            },
        })

        expect(failed).toBe(false)
        expect(completed).toBe(false)
    })

    it('[RX #3] 完成後不再推送', () => {
        const stream = createErrorStream()
        const seen: string[] = []
        stream.observable.subscribe((error) => seen.push(error.message))

        stream.complete()
        stream.push(new DocumentContextError('HOOK_ERROR', 'late'))

        expect(seen).toEqual([])
    })

    it('[RX #4] 錯誤回呼裡再推送時，其他訂閱者仍按順序收到', () => {
        const stream = createErrorStream()
        const first: string[] = []
        const second: string[] = []
        stream.observable.subscribe((error) => {
            first.push(error.message)
            if (error.message === 'one') {
                stream.push(new DocumentContextError('HOOK_ERROR', 'two'))
            }
        })
        stream.observable.subscribe((error) => {
            second.push(error.message)
        })

        stream.push(new DocumentContextError('HOOK_ERROR', 'one'))

        expect(first).toEqual(['one', 'two'])
        expect(second).toEqual(['one', 'two'])
    })
})
