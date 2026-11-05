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

describe('dom late binding', () => {
    it('[SCOPE #12] 元素目標在提供者出現前保持 pending', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element('section')
        const leaf = element('span')
        host.appendChild(leaf)

        let settled = false
        const pending = app.inject(themeToken)(leaf).then((value) => {
            settled = true
            return value
        })
        pending.catch(() => {
            settled = true
        })
        await flush()

        expect(settled).toBe(false)

        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark')),
        )(host)
        await session.ready
        await flush()

        await expect(pending).resolves.toBe('dark')
    })

    it('[API #11] 元素目標的空多值永不結案', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element('section')
        const leaf = element('span')
        host.appendChild(leaf)

        const values: string[][] = []
        let completed = false
        const subscription = app.injectAll$(pluginToken)(leaf).subscribe({
            next: (value) => values.push(value),
            complete: () => {
                completed = true
            },
        })
        await flush()

        expect(values).toEqual([])
        expect(completed).toBe(false)

        subscription.unsubscribe()
    })
})
