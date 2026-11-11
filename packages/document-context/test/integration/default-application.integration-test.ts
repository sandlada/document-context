import { afterEach, describe, expect, it } from 'vitest'
import { createContext } from '../../src/domain/model/blueprint'
import { DocumentContextError } from '../../src/domain/model/errors'
import { CONTEXT_MOUNT_EVENT } from '../../src/infrastructure/dom/context-protocol'
import { getDefaultApplication, mount, setDefaultApplication } from '../../src/index'

describe('default application', () => {
    afterEach(() => {
        setDefaultApplication(null)
    })

    it('[PORT #3] setDefaultApplication 釋放上一個預設 Application 與它的 DOM 監聽', async () => {
        const removed: string[] = []
        const originalRemove = document.removeEventListener.bind(document)
        document.removeEventListener = ((
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | EventListenerOptions,
        ) => {
            removed.push(type)
            originalRemove(type, listener, options)
        }) as typeof document.removeEventListener

        const host = document.createElement('div')
        document.body.appendChild(host)
        try {
            const app = getDefaultApplication()
            const session = mount(createContext({ count: 1 }))(host)
            await session.ready

            setDefaultApplication(null)

            expect(session.status).toBe('disposed')
            expect(removed).toContain(CONTEXT_MOUNT_EVENT)
            expect(() => app.mount(createContext({ count: 0 }))(host)).toThrow(DocumentContextError)
            expect(getDefaultApplication()).not.toBe(app)
        } finally {
            document.removeEventListener = originalRemove
            host.remove()
        }
    })
})
