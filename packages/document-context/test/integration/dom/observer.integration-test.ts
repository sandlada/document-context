import { afterEach, describe, expect, it } from 'vitest'
import { createFakeClock } from '../../../src/application/testing/fakes'
import { createDomObserver } from '../../../src/infrastructure/dom/observer'

const created: Element[] = []

function element(tag = 'div'): Element {
    const node = document.createElement(tag)
    document.body.appendChild(node)
    created.push(node)
    return node
}

async function flushRealMicrotasks(): Promise<void> {
    for (let index = 0; index < 8; index += 1) {
        await Promise.resolve()
    }
}

afterEach(() => {
    for (const node of created.splice(0)) {
        node.remove()
    }
})

describe('dom observer', () => {
    it('[LC #3] 斷線由排程埠上的重檢確認', async () => {
        const clock = createFakeClock()
        const observer = createDomObserver(document, clock)
        const node = element('div')

        const states: boolean[] = []
        observer.observe(node, (connected) => {
            states.push(connected)
        })

        node.remove()
        await flushRealMicrotasks()
        await clock.flushMicrotasks()

        expect(states).toEqual([false])
        observer.release()
    })

    it('[LC #3] 搬家不算斷線', async () => {
        const clock = createFakeClock()
        const observer = createDomObserver(document, clock)
        const node = element('div')
        const parent = element('section')

        const states: boolean[] = []
        observer.observe(node, (connected) => {
            states.push(connected)
        })

        node.remove()
        parent.appendChild(node)
        await flushRealMicrotasks()
        await clock.flushMicrotasks()

        expect(states).toEqual([])
        observer.release()
    })

    it('[PORT #7] 解除觀察後不再回報連線變化', async () => {
        const clock = createFakeClock()
        const observer = createDomObserver(document, clock)
        const node = element('div')

        const states: boolean[] = []
        const stop = observer.observe(node, (connected) => {
            states.push(connected)
        })
        stop()

        node.remove()
        await flushRealMicrotasks()
        await clock.flushMicrotasks()

        expect(states).toEqual([])
        observer.release()
    })
})
