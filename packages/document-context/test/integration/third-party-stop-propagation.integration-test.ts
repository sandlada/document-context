import { afterEach, describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../src/domain/model/blueprint'
import { defineToken } from '../../src/domain/model/token'
import { createApplication } from '../../src/application/application'
import { provide } from '../../src/application/api/provide'
import { createDomHostAdapter } from '../../src/infrastructure/dom/host-adapter'
import { CONTEXT_REQUEST_EVENT } from '../../src/infrastructure/dom/context-protocol'

const themeToken = defineToken<string>('public')('app:theme')

const created: Element[] = []

function element(tag = 'div'): Element {
    const node = document.createElement(tag)
    document.body.appendChild(node)
    created.push(node)
    return node
}

afterEach(() => {
    for (const node of created.splice(0)) {
        node.remove()
    }
})

describe('third party interop', () => {
    it('[SCOPE #4] 第三方 stopPropagation 不破壞本庫解析', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })

        const outer = element('section')
        const middle = element('div')
        const leaf = element('span')
        outer.appendChild(middle)
        middle.appendChild(leaf)

        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark')),
        )(outer)
        await session.ready

        // 第三方在路徑中間攔截事件並停止冒泡。
        middle.addEventListener(CONTEXT_REQUEST_EVENT, (event) => {
            event.stopPropagation()
        })

        await expect(app.inject(themeToken)(leaf)).resolves.toBe('dark')
    })

    it('[SCOPE #4] 第三方停止冒泡時本庫的 DOM 請求到不了提供者', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })

        const outer = element('section')
        const middle = element('div')
        const leaf = element('span')
        outer.appendChild(middle)
        middle.appendChild(leaf)

        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark')),
        )(outer)
        await session.ready

        middle.addEventListener(CONTEXT_REQUEST_EVENT, (event) => {
            event.stopPropagation()
        })

        const answers: unknown[] = []
        leaf.dispatchEvent(
            new CustomEvent(CONTEXT_REQUEST_EVENT, {
                bubbles: true,
                composed: true,
                cancelable: false,
                detail: {
                    context: 'app:theme',
                    callback: (value: unknown) => {
                        answers.push(value)
                    },
                },
            }),
        )

        // 事件被第三方截斷：這正是本庫不能靠冒泡完成解析的理由。
        expect(answers).toEqual([])
    })

    it('[SCOPE #4] 第三方作為提供者時本庫的消費者拿到較近的值', async () => {
        const providerBundle = createDomHostAdapter()
        const consumerBundle = createDomHostAdapter()
        const providerApp = createApplication({ host: providerBundle })
        const consumerApp = createApplication({ host: consumerBundle })

        const outer = element('section')
        const middle = element('div')
        const leaf = element('span')
        outer.appendChild(middle)
        middle.appendChild(leaf)

        const farSession = providerApp.mount(
            pipe(createContext({}), provide(themeToken, () => 'far')),
        )(outer)
        await farSession.ready

        // 第三方實作：回答請求並設旗標，不使用 stopPropagation。
        middle.addEventListener(CONTEXT_REQUEST_EVENT, (event) => {
            const detail = (event as CustomEvent<{
                context: string
                callback: (value: unknown) => void
                resolved?: boolean
            }>).detail
            if (detail.context !== 'app:theme' || detail.resolved === true) {
                return
            }
            detail.resolved = true
            detail.callback('third-party')
        })

        let reachedDocument = false
        const listener = (): void => {
            reachedDocument = true
        }
        document.addEventListener(CONTEXT_REQUEST_EVENT, listener)

        const consumerSession = consumerApp.mount(pipe(createContext({})))(leaf)
        await consumerSession.ready

        await expect(consumerApp.inject(themeToken)(leaf)).resolves.toBe('third-party')
        expect(reachedDocument).toBe(true)

        document.removeEventListener(CONTEXT_REQUEST_EVENT, listener)
    })
})
