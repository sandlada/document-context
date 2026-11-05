import { afterEach, describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../../src/domain/model/blueprint'
import { createApplication } from '../../../src/application/application'
import { createDomHostAdapter } from '../../../src/infrastructure/dom/host-adapter'
import type { Session } from '../../../src/domain/model/session'

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

describe('dom session stream', () => {
    it('[RX #9] session$ 只認 active', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element('section')
        const leaf = element('span')
        host.appendChild(leaf)

        const seen: (Session<any, any> | null)[] = []
        const subscription = app.session$(leaf).subscribe((session) => {
            seen.push(session)
        })

        expect(seen).toEqual([null])

        const session = app.mount(pipe(createContext({})))(host)
        await session.ready
        await flush()

        expect(seen[seen.length - 1]).toBe(session)

        app.dispose(session)
        await flush()

        expect(seen[seen.length - 1]).toBeNull()
        subscription.unsubscribe()
    })

    it('[RX #9] 恢復送回同一物件', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element('section')
        const leaf = element('span')
        host.appendChild(leaf)

        const session = app.mount(pipe(createContext({})), { token: 'app:keyed' })(host)
        await session.ready
        expect(session.status).toBe('active')

        // 拔掉節點：keyed 會話轉 suspended，不進入暫停表的觀察範圍。
        host.remove()
        await flush()

        expect(session.status).toBe('suspended')
        expect(app.sessionAt(leaf)).toBeNull()

        // 同一個 token 回到新宿主：復甦的是同一個 Session 物件。
        const other = element('section')
        const otherLeaf = element('span')
        other.appendChild(otherLeaf)

        const resumed = app.mount(pipe(createContext({})), { token: 'app:keyed' })(other)

        expect(resumed).toBe(session)
        expect(session.status).toBe('active')
        expect(app.sessionAt(otherLeaf)).toBe(session)
    })
})
