import { describe, expect, it } from 'vitest'
import { createContext, pipe } from '../domain/model/blueprint'
import { defineToken } from '../domain/model/token'
import type { ContextRequestDetail } from '../domain/ports/scope-transport'
import { provide } from './api/provide'
import { createRequestHandler } from './resolver'
import type { SessionRuntime } from './session'
import { createTestApplication } from './testing/fakes'

const themeToken = defineToken<string>('public')('app:theme')

describe('context request handler', () => {
    it('[SCOPE #4] callback 丟錯時不設 resolved', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'near')),
        )(adapter.createHost()) as SessionRuntime
        await session.ready

        const detail: ContextRequestDetail = {
            context: 'app:theme',
            callback: () => {
                throw new Error('boom')
            },
        }

        expect(() => createRequestHandler(session.owner, session)(detail)).toThrow('boom')
        expect(detail.resolved).toBeUndefined()
    })

    it('[SCOPE #4] callback 成功後才設 resolved', async () => {
        const { app, adapter } = createTestApplication()
        const session = app.mount(
            pipe(createContext({}), provide(themeToken, () => 'near')),
        )(adapter.createHost()) as SessionRuntime
        await session.ready

        let resolvedDuringCallback: boolean | undefined
        const detail: ContextRequestDetail = {
            context: 'app:theme',
            callback: () => {
                resolvedDuringCallback = detail.resolved
            },
        }

        createRequestHandler(session.owner, session)(detail)

        expect(resolvedDuringCallback).toBeUndefined()
        expect(detail.resolved).toBe(true)
    })

    it('[SCOPE #9] 落敗的單值 singleton 不回答 context-request', async () => {
        const { app, adapter } = createTestApplication()
        const token = defineToken<string>('public')('app:handler-singleton')
        let calls = 0
        const owner = app.mount(
            pipe(
                createContext({}),
                provide(token, () => 'multi', { lifecycle: 'singleton', multi: true }),
            ),
        )(adapter.createHost())
        await owner.ready
        const session = app.mount(
            pipe(
                createContext({}),
                provide(token, () => {
                    calls += 1
                    return 'single'
                }, { lifecycle: 'singleton' }),
            ),
        )(adapter.createHost()) as SessionRuntime
        await session.ready

        const values: unknown[] = []
        const detail: ContextRequestDetail = {
            context: 'app:handler-singleton',
            callback: (value: unknown) => {
                values.push(value)
            },
        }
        createRequestHandler(session.owner, session)(detail)
        await Promise.resolve()

        expect(values).toEqual([])
        expect(detail.resolved).toBeUndefined()
        expect(calls).toBe(0)
    })
})
