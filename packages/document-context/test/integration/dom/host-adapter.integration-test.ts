import { afterEach, describe, expect, it } from 'vitest'
import { DocumentContextError } from '../../../src/domain/model/errors'
import { createApplication } from '../../../src/application/application'
import { createDomHostAdapter } from '../../../src/infrastructure/dom/host-adapter'
import { KEYED_IDENTITY_ATTRIBUTE } from '../../../src/infrastructure/dom/host-adapter'

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

describe('dom host adapter', () => {
    it('[API #14] 未連線元素拋 UNCONNECTED_HOST', () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const detached = document.createElement('div')

        try {
            app.mount({ state: {}, providers: [], hooks: [] })(detached)
            expect.unreachable('mount should have thrown')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('UNCONNECTED_HOST')
        }
    })

    it('[API #14] 非元素拋 HOST_INVALID', () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })

        try {
            app.mount({ state: {}, providers: [], hooks: [] })(
                document.createTextNode('text') as unknown as Element,
            )
            expect.unreachable('mount should have thrown')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('HOST_INVALID')
        }
    })

    it('[SCOPE #11] keyed 身分寫回宿主並在銷毀時移除', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element()

        const session = app.mount({ state: {}, providers: [], hooks: [] }, { token: 'app:keyed' })(
            host,
        )
        await session.ready

        expect(host.getAttribute(KEYED_IDENTITY_ATTRIBUTE)).toBe('app:keyed')

        app.dispose(session)

        expect(host.getAttribute(KEYED_IDENTITY_ATTRIBUTE)).toBeNull()
    })

    it('[SCOPE #11] 非法 key 名以 TOKEN_INVALID 拒絕', () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element()
        host.setAttribute(KEYED_IDENTITY_ATTRIBUTE, 'not-a-valid-key')

        try {
            app.mount({ state: {}, providers: [], hooks: [] })(host)
            expect.unreachable('mount should have thrown')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('TOKEN_INVALID')
        }
    })

    it('[SCOPE #11] 寫入非法 key 名以 TOKEN_INVALID 拒絕', () => {
        const adapter = createDomHostAdapter()
        const host = adapter.hostOf(element())
        expect(() => adapter.tokens.write(host, 'not-a-valid-key')).toThrowError(DocumentContextError)
        try {
            adapter.tokens.write(host, 'not-a-valid-key')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('TOKEN_INVALID')
        }
        expect(host.element.getAttribute(KEYED_IDENTITY_ATTRIBUTE)).toBeNull()
    })

    it('[SCOPE #2] 作用域鏈不跨 Document 邊界', () => {
        const adapter = createDomHostAdapter()
        const other = document.implementation.createHTMLDocument('other')
        const foreign = other.createElement('div')
        other.body.appendChild(foreign)

        const local = element()
        expect(adapter.scope.contains(adapter.hostOf(local), adapter.hostOf(foreign))).toBe(false)
    })

    it('[SCOPE #11] 銷毀時不移除屬於其他 token 的 key', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })
        const host = element()

        const session = app.mount({ state: {}, providers: [], hooks: [] }, { token: 'app:mine' })(
            host,
        )
        await session.ready
        host.setAttribute(KEYED_IDENTITY_ATTRIBUTE, 'app:other')

        app.dispose(session)

        expect(host.getAttribute(KEYED_IDENTITY_ATTRIBUTE)).toBe('app:other')
    })
})
