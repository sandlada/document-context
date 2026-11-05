import { afterEach, describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../../src/domain/model/blueprint'
import { defineToken } from '../../../src/domain/model/token'
import { createApplication } from '../../../src/application/application'
import { provide } from '../../../src/application/api/provide'
import { createDomHostAdapter } from '../../../src/infrastructure/dom/host-adapter'

const themeToken = defineToken<string>('public')('app:theme')
const pluginToken = defineToken<string>('public')('app:plugin')

const created: Element[] = []

function element(tag = 'div'): Element {
    const node = document.createElement(tag)
    document.body.appendChild(node)
    created.push(node)
    return node
}

async function flush(): Promise<void> {
    for (let index = 0; index < 8; index += 1) {
        await Promise.resolve()
    }
}

afterEach(() => {
    for (const node of created.splice(0)) {
        node.remove()
    }
})

describe('dom scope transport', () => {
    it('[SCOPE #1] 單值注入近者勝', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })

        const outer = element('section')
        const inner = element('div')
        const leaf = element('span')
        outer.appendChild(inner)
        inner.appendChild(leaf)

        const outerSession = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'light')),
        )(outer)
        const innerSession = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark')),
        )(inner)
        await outerSession.ready
        await innerSession.ready

        await expect(app.inject(themeToken)(leaf)).resolves.toBe('dark')
    })

    it('[SCOPE #1] 存在 multi 註冊時單值注入仍 nearest-wins', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })

        const outer = element('section')
        const inner = element('div')
        const leaf = element('span')
        outer.appendChild(inner)
        inner.appendChild(leaf)

        const outerSession = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'light')),
        )(outer)
        const innerSession = app.mount(
            pipe(
                createContext({}),
                provide(themeToken, () => 'dark'),
                provide(pluginToken, () => 'inner-plugin', { multi: true }),
            ),
        )(inner)
        await outerSession.ready
        await innerSession.ready

        // multi 註冊是累加而不是覆蓋：單值注入仍拿到最近的單值提供者。
        await expect(app.inject(themeToken)(leaf)).resolves.toBe('dark')
        await expect(app.injectAll(pluginToken)(leaf)).resolves.toEqual(['inner-plugin'])
    })

    it('[SCOPE #2] 作用域鏈不跨 Document 邊界', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })

        const other = document.implementation.createHTMLDocument('other')
        const foreign = other.createElement('div')
        other.body.appendChild(foreign)

        const local = element('section')
        const standalone = element('span')
        local.appendChild(standalone)

        const foreignSession = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'foreign')),
        )(foreign)
        await foreignSession.ready

        expect(adapter.scope.contains(adapter.hostOf(local), adapter.hostOf(foreign))).toBe(false)
        expect(adapter.scope.contains(adapter.hostOf(foreign), adapter.hostOf(local))).toBe(false)

        // 另一份 Document 裡的提供者不在本文件的鏈上：注入保持 pending，不會跨邊界解析。
        let settled = false
        void app
            .inject(themeToken)(standalone)
            .then(
                () => {
                    settled = true
                },
                () => {
                    settled = true
                },
            )
        await flush()

        expect(settled).toBe(false)
        app.release()
    })
})
