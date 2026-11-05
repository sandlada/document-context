import { afterEach, describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../../src/domain/model/blueprint'
import { defineToken } from '../../../src/domain/model/token'
import type { ContextRequestDetail } from '../../../src/domain/ports/scope-transport'
import { createApplication } from '../../../src/application/application'
import { provide } from '../../../src/application/api/provide'
import { createDomHostAdapter } from '../../../src/infrastructure/dom/host-adapter'
import {
    CONTEXT_DISPOSE_EVENT,
    CONTEXT_MOUNT_EVENT,
    CONTEXT_REQUEST_EVENT,
} from '../../../src/infrastructure/dom/context-protocol'

const themeToken = defineToken<string>('public')('app:theme')

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

describe('context protocol', () => {
    it('[SCOPE #4] 單值請求以 detail.resolved 終止', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element()
        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark')),
        )(host)
        await session.ready

        const detail = { context: 'app:theme', callback: () => undefined, resolved: false }
        host.dispatchEvent(
            new CustomEvent(CONTEXT_REQUEST_EVENT, {
                bubbles: true,
                composed: true,
                cancelable: false,
                detail,
            }),
        )

        expect(detail.resolved).toBe(true)
    })

    it('[SCOPE #4] nearest-wins 不依賴 stopPropagation 且事件仍冒泡到 document', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element()
        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark')),
        )(host)
        await session.ready

        const values: unknown[] = []
        const detail = { context: 'app:theme', callback: (value: unknown) => values.push(value) }
        let reachedDocument = false
        const listener = (): void => {
            reachedDocument = true
        }
        document.addEventListener(CONTEXT_REQUEST_EVENT, listener)

        host.dispatchEvent(
            new CustomEvent(CONTEXT_REQUEST_EVENT, {
                bubbles: true,
                composed: true,
                cancelable: false,
                detail,
            }),
        )
        document.removeEventListener(CONTEXT_REQUEST_EVENT, listener)

        expect(values).toHaveLength(1)
        expect(reachedDocument).toBe(true)
    })

    it('[SCOPE #4] multi 請求不設 resolved 旗標', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element()
        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark', { multi: true })),
        )(host)
        await session.ready

        const detail: ContextRequestDetail = {
            context: 'app:theme',
            callback: () => undefined,
            multi: true,
        }
        host.dispatchEvent(
            new CustomEvent(CONTEXT_REQUEST_EVENT, {
                bubbles: true,
                composed: true,
                cancelable: false,
                detail,
            }),
        )

        expect(detail.resolved).toBeUndefined()
    })

    it('[SCOPE #4] context-request 的 bubbles / composed / cancelable 形狀', () => {
        const event = new CustomEvent(CONTEXT_REQUEST_EVENT, {
            bubbles: true,
            composed: true,
            cancelable: false,
            detail: { context: 'app:theme', callback: () => undefined },
        })

        expect(event.type).toBe('context-request')
        expect(event.bubbles).toBe(true)
        expect(event.composed).toBe(true)
        expect(event.cancelable).toBe(false)
    })

    it('[LC #11] 會話進入 active 後派發 context-mount', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element()

        const events: unknown[] = []
        host.addEventListener(CONTEXT_MOUNT_EVENT, (event) => {
            events.push((event as CustomEvent<{ context: string | null }>).detail)
        })

        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark')),
            { token: 'app:mounted' },
        )(host)
        await session.ready

        expect(events).toEqual([{ context: 'app:mounted' }])
    })

    it('[LC #11] 銷毀時派發 context-dispose', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element()

        const events: unknown[] = []
        host.addEventListener(CONTEXT_DISPOSE_EVENT, (event) => {
            events.push((event as CustomEvent<{ context: string | null }>).detail)
        })

        const session = app.mount({ state: {}, providers: [], hooks: [] })(host)
        await session.ready
        app.dispose(session)

        expect(events).toEqual([{ context: null }])
    })

    it('[SCOPE #4] 只有 active 會話回答 context-request', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element()
        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark')),
        )(host)

        const values: unknown[] = []
        const detail = { context: 'app:theme', callback: (value: unknown) => values.push(value) }
        host.dispatchEvent(
            new CustomEvent(CONTEXT_REQUEST_EVENT, {
                bubbles: true,
                composed: true,
                cancelable: false,
                detail,
            }),
        )

        expect(values).toHaveLength(0)

        await session.ready
        host.dispatchEvent(
            new CustomEvent(CONTEXT_REQUEST_EVENT, {
                bubbles: true,
                composed: true,
                cancelable: false,
                detail,
            }),
        )

        expect(values).toHaveLength(1)
    })

    it('[SCOPE #4] composed 事件穿過 shadow 邊界', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })

        // 宿主本身是 shadow host：請求從 shadow tree 內部派發，
        // 必須靠 composed 穿過 shadow 邊界才能抵達宿主上的監聽器。
        const host = element()
        const root = host.attachShadow({ mode: 'open' })
        const inner = document.createElement('span')
        root.appendChild(inner)

        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark')),
        )(host)
        await session.ready

        const values: unknown[] = []
        const detail = { context: 'app:theme', callback: (value: unknown) => values.push(value) }
        inner.dispatchEvent(
            new CustomEvent(CONTEXT_REQUEST_EVENT, {
                bubbles: true,
                composed: true,
                cancelable: false,
                detail,
            }),
        )

        expect(values).toHaveLength(1)
        expect(await Promise.all(values)).toEqual(['dark'])
    })

    it('[SCOPE #4] 本庫只派發三種事件名', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element()

        const names: string[] = []
        const observer = new MutationObserver(() => undefined)
        for (const name of ['context-mount', 'context-dispose', 'context-request']) {
            host.addEventListener(name, (event) => names.push(event.type))
        }
        observer.disconnect()

        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'dark')),
        )(host)
        await session.ready
        app.dispose(session)

        expect(new Set(names)).toEqual(
            new Set([CONTEXT_MOUNT_EVENT, CONTEXT_DISPOSE_EVENT]),
        )
        await flush()
    })
})
