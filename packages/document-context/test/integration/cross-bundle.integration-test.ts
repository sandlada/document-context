import { afterEach, describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../src/domain/model/blueprint'
import { defineToken } from '../../src/domain/model/token'
import { createApplication } from '../../src/application/application'
import { provide } from '../../src/application/api/provide'
import { createDomHostAdapter } from '../../src/infrastructure/dom/host-adapter'

const themeToken = defineToken<string>('public')('app:theme')
const localeToken = defineToken<string>('public')('app:locale')

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

describe('cross bundle', () => {
    it('[SCOPE #4] 兩個 Application 在同一份 Document 雙向解析字串 token', async () => {
        // 兩個 bundle：各自的 adapter、自己的 Application、只共享 DOM 事件與 token 字串。
        const providerBundle = createDomHostAdapter()
        const consumerBundle = createDomHostAdapter()
        const providerApp = createApplication({ host: providerBundle })
        const consumerApp = createApplication({ host: consumerBundle })

        const themeBranch = element('section')
        const themeLeaf = element('span')
        themeBranch.appendChild(themeLeaf)

        const localeBranch = element('section')
        const localeLeaf = element('span')
        localeBranch.appendChild(localeLeaf)

        const themeSession = providerApp.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark')),
        )(themeBranch)
        const localeSession = consumerApp.mount(
            pipe(createContext({}), provide(localeToken, () => 'zh-TW')),
        )(localeBranch)
        await themeSession.ready
        await localeSession.ready

        // 消費端 bundle 的 provider 在消費端 bundle 的祖先上。
        const consumerSession = consumerApp.mount(pipe(createContext({})))(themeLeaf)
        const otherConsumerSession = providerApp.mount(pipe(createContext({})))(localeLeaf)
        await consumerSession.ready
        await otherConsumerSession.ready

        await expect(consumerApp.inject(themeToken)(themeLeaf)).resolves.toBe('dark')
        await expect(providerApp.inject(localeToken)(localeLeaf)).resolves.toBe('zh-TW')
    })

    it('[SCOPE #4] 跨 Application 的 nearest-wins 由冒泡順序決定', async () => {
        const nearBundle = createDomHostAdapter()
        const farBundle = createDomHostAdapter()
        const consumerBundle = createDomHostAdapter()

        const nearApp = createApplication({ host: nearBundle })
        const farApp = createApplication({ host: farBundle })
        const consumerApp = createApplication({ host: consumerBundle })

        const outer = element('section')
        const inner = element('div')
        const leaf = element('span')
        outer.appendChild(inner)
        inner.appendChild(leaf)

        const farSession = farApp.mount(
            pipe(createContext({}), provide(themeToken, () => 'far')),
        )(outer)
        const nearSession = nearApp.mount(
            pipe(createContext({}), provide(themeToken, () => 'near')),
        )(inner)
        await farSession.ready
        await nearSession.ready

        const consumerSession = consumerApp.mount(pipe(createContext({})))(leaf)
        await consumerSession.ready

        await expect(consumerApp.inject(themeToken)(leaf)).resolves.toBe('near')
    })

    it('[SCOPE #4] 私有 token 不跨 Application', async () => {
        const privateToken = defineToken<string>('private')('secret')
        const providerBundle = createDomHostAdapter()
        const consumerBundle = createDomHostAdapter()
        const providerApp = createApplication({ host: providerBundle })
        const consumerApp = createApplication({ host: consumerBundle })

        const host = element('section')
        const leaf = element('span')
        host.appendChild(leaf)

        const providerSession = providerApp.mount(
            pipe(createContext({}), provide(privateToken, () => 'secret')),
        )(host)
        await providerSession.ready

        const consumerSession = consumerApp.mount(pipe(createContext({})))(leaf)
        await consumerSession.ready

        let settled = false
        void consumerApp
            .inject(privateToken)(leaf)
            .then(
                () => {
                    settled = true
                },
                () => {
                    settled = true
                },
            )
        await Promise.resolve()
        await Promise.resolve()

        expect(settled).toBe(false)
    })

    it('[SCOPE #6] 跨 bundle 的 injectAll 只反轉宿主分組', async () => {
        const pluginToken = defineToken<string>('public')('app:plugin')
        const nearBundle = createDomHostAdapter()
        const farBundle = createDomHostAdapter()
        const consumerBundle = createDomHostAdapter()
        const nearApp = createApplication({ host: nearBundle })
        const farApp = createApplication({ host: farBundle })
        const consumerApp = createApplication({ host: consumerBundle })

        const outer = element('section')
        const inner = element('div')
        const leaf = element('span')
        outer.appendChild(inner)
        inner.appendChild(leaf)

        const farSession = farApp.mount(
            pipe(
                createContext({}),
                provide(pluginToken, () => 'far-a', { multi: true }),
                provide(pluginToken, () => 'far-b', { multi: true }),
            ),
        )(outer)
        const nearSession = nearApp.mount(
            pipe(
                createContext({}),
                provide(pluginToken, () => 'near-a', { multi: true }),
                provide(pluginToken, () => 'near-b', { multi: true }),
            ),
        )(inner)
        await farSession.ready
        await nearSession.ready

        await expect(consumerApp.injectAll(pluginToken)(leaf)).resolves.toEqual([
            'near-a',
            'near-b',
            'far-a',
            'far-b',
        ])
        await expect(
            consumerApp.injectAll(pluginToken, { direction: 'from-top-to-bottom' })(leaf),
        ).resolves.toEqual(['far-a', 'far-b', 'near-a', 'near-b'])
    })
})
