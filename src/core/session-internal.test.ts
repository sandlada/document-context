import { describe, expect, it } from 'vitest'
import {
    getInternalSession,
    setInternalSession,
    getElementSession,
    setElementSession,
    removeElementSession,
    createInternalSessionState
} from './session-internal'
import { createContext } from './context'
import type { ISession } from './types'

describe('session-internal', () => {
    it('manages internal session state mapping with WeakMap', () => {
        const el = document.createElement('div')
        const bp = createContext({ x: 1 })
        const dummySession = { target: el, blueprint: bp } as unknown as ISession<{ x: number }>

        const internal = createInternalSessionState(el, bp)
        setInternalSession(dummySession, internal)

        expect(getInternalSession(dummySession)).toBe(internal)
        expect(internal.stateSubject.getValue()).toEqual({ x: 1 })
    })

    it('tracks element to session association', () => {
        const el = document.createElement('div')
        const dummySession = { target: el } as unknown as ISession

        setElementSession(el, dummySession)
        expect(getElementSession(el)).toBe(dummySession)

        removeElementSession(el)
        expect(getElementSession(el)).toBeUndefined()
    })
})
