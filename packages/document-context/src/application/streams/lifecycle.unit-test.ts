import { describe, expect, it } from 'vitest'
import { createLifecycleStream } from './lifecycle'

describe('lifecycle stream', () => {
    it('[RX #5] starting 沒有背靠事件', () => {
        const stream = createLifecycleStream()
        const seen: string[] = []

        stream.observable.subscribe((event) => seen.push(event.type))

        expect(seen).toEqual([])
    })

    it('[RX #5] 背靠當前狀態那一筆', () => {
        const stream = createLifecycleStream()
        stream.transition({ type: 'active' }, { type: 'active' })

        const seen: string[] = []
        stream.observable.subscribe((event) => seen.push(event.type))

        expect(seen).toEqual(['active'])
    })

    it('[RX #5] 不重播歷史', () => {
        const stream = createLifecycleStream()
        stream.transition({ type: 'active' }, { type: 'active' })
        stream.transition({ type: 'suspended' }, { type: 'suspended' })

        const seen: string[] = []
        stream.observable.subscribe((event) => seen.push(event.type))

        expect(seen).toEqual(['suspended'])
    })

    it('[RX #5] 增量事件在背靠事件之後送達', () => {
        const stream = createLifecycleStream()
        stream.transition({ type: 'active' }, { type: 'active' })

        const seen: string[] = []
        stream.observable.subscribe((event) => seen.push(event.type))

        stream.transition({ type: 'active' }, { type: 'resumed' })

        expect(seen).toEqual(['active', 'resumed'])
    })

    it('[RX #3] 完成後不再推送', () => {
        const stream = createLifecycleStream()
        const seen: string[] = []
        let completed = false
        stream.observable.subscribe({
            next: (event) => seen.push(event.type),
            complete: () => {
                completed = true
            },
        })

        stream.complete()
        stream.transition({ type: 'active' }, { type: 'active' })

        expect(completed).toBe(true)
        expect(seen).toEqual([])
    })
})
