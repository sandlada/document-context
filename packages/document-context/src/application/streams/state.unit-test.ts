import { describe, expect, it } from 'vitest'
import { createStateStream } from './state'

describe('state stream', () => {
    it('[RX #1] 新訂閱立即取得當前快照', () => {
        const stream = createStateStream({ count: 0 })
        const seen: number[] = []

        stream.observable.subscribe((state) => seen.push(state.count))

        expect(seen).toEqual([0])
    })

    it('[RX #2] 背靠快照的回呼裡再推送不會遺失', () => {
        const stream = createStateStream({ count: 0 })
        const seen: number[] = []
        stream.observable.subscribe((state) => {
            seen.push(state.count)
            if (state.count === 0) {
                stream.push({ count: 1 })
            }
        })

        expect(seen).toEqual([0, 1])
    })

    it('[RX #2] 推送同步發生', () => {
        const stream = createStateStream({ count: 0 })
        const seen: number[] = []
        stream.observable.subscribe((state) => seen.push(state.count))

        stream.push({ count: 1 })

        expect(seen).toEqual([0, 1])
    })

    it('[RX #2] 引用相同的快照不推送', () => {
        const stream = createStateStream({ count: 0 })
        const seen: number[] = []
        stream.observable.subscribe((state) => seen.push(state.count))

        const same = stream.current()
        stream.push(same)

        expect(seen).toEqual([0])
    })

    it('[RX #3] 完成後不再推送', () => {
        const stream = createStateStream({ count: 0 })
        const seen: number[] = []
        let completed = false
        stream.observable.subscribe({
            next: (state) => seen.push(state.count),
            complete: () => {
                completed = true
            },
        })

        stream.complete()
        stream.push({ count: 1 })

        expect(completed).toBe(true)
        expect(seen).toEqual([0])
    })

    it('[RX #7] 退訂後不再收到推送', () => {
        const stream = createStateStream({ count: 0 })
        const seen: number[] = []
        const subscription = stream.observable.subscribe((state) => seen.push(state.count))

        subscription.unsubscribe()
        stream.push({ count: 1 })

        expect(seen).toEqual([0])
    })

    it('[RX #1] 每個訂閱者都收到全部推送', () => {
        const stream = createStateStream({ count: 0 })
        const first: number[] = []
        const second: number[] = []
        stream.observable.subscribe((state) => first.push(state.count))
        stream.observable.subscribe((state) => second.push(state.count))

        stream.push({ count: 1 })

        expect(first).toEqual([0, 1])
        expect(second).toEqual([0, 1])
    })

    it('[RX #2] 推送回呼裡再推送時，其他訂閱者仍按順序收到', () => {
        const stream = createStateStream({ count: 0 })
        const first: number[] = []
        const second: number[] = []
        stream.observable.subscribe((state) => {
            first.push(state.count)
            if (state.count === 1) {
                stream.push({ count: 2 })
            }
        })
        stream.observable.subscribe((state) => {
            second.push(state.count)
        })

        stream.push({ count: 1 })

        expect(first).toEqual([0, 1, 2])
        expect(second).toEqual([0, 1, 2])
    })
})
