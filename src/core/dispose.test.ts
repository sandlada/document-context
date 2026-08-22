import { describe, expect, it } from 'vitest'
import { createContext } from './context'
import { withHook } from './hooks'
import { mount } from './mount'
import { pipe } from './pipe'
import { dispose, readErrorStream } from './dispose'

describe('dispose & readErrorStream', () => {
    it('marks session as disposed, aborts signal, and dispatches context-dispose event', () => {
        const el = document.createElement('div')
        const bp = createContext({})
        let disposeEventDetail: any = null

        el.addEventListener('context-dispose', (e: any) => {
            disposeEventDetail = e.detail
        })

        const session = mount(bp)(el)
        expect(session.isDisposed).toBe(false)
        expect(session.abortSignal.aborted).toBe(false)

        dispose(session)

        expect(session.isDisposed).toBe(true)
        expect(session.abortSignal.aborted).toBe(true)
        expect(disposeEventDetail).toBeDefined()
    })

    it('executes mount cleanups and dispose hooks in LIFO (reverse) order', () => {
        const el = document.createElement('div')
        const executionOrder: string[] = []

        const bp = pipe(
            createContext({}),
            withHook('mount', () => {
                return () => {
                    executionOrder.push('mount-cleanup-1')
                }
            }),
            withHook('mount', () => {
                return () => {
                    executionOrder.push('mount-cleanup-2')
                }
            }),
            withHook('dispose', () => {
                executionOrder.push('dispose-hook-1')
            }),
            withHook('dispose', () => {
                executionOrder.push('dispose-hook-2')
            })
        )

        const session = mount(bp)(el)
        dispose(session)

        expect(executionOrder).toEqual([
            'dispose-hook-2',
            'dispose-hook-1',
            'mount-cleanup-2',
            'mount-cleanup-1'
        ])
    })

    it('sandboxes errors during hook execution and forwards them to readErrorStream', () => {
        const el = document.createElement('div')
        const capturedErrors: any[] = []

        const bp = pipe(
            createContext({}),
            withHook('mount', () => {
                return () => {
                    throw new Error('Failing mount cleanup')
                }
            }),
            withHook('dispose', () => {
                throw new Error('Failing dispose hook')
            })
        )

        const session = mount(bp)(el)
        const sub = readErrorStream(session).subscribe((err) => {
            capturedErrors.push(err)
        })

        expect(() => {
            dispose(session)
        }).not.toThrow()

        expect(session.isDisposed).toBe(true)
        expect(capturedErrors.length).toBe(2)
        expect(capturedErrors[0].message).toContain('Failing dispose hook')
        expect(capturedErrors[1].message).toContain('Failing mount cleanup')

        sub.unsubscribe()
    })

    it('supports TC39 Symbol.dispose and Symbol.asyncDispose', async () => {
        const el = document.createElement('div')
        const bp = createContext({})
        const session = mount(bp)(el)

        session[Symbol.dispose]()
        expect(session.isDisposed).toBe(true)

        const el2 = document.createElement('div')
        const session2 = mount(bp)(el2)
        await session2[Symbol.asyncDispose]()
        expect(session2.isDisposed).toBe(true)
    })

    it('is idempotent on multiple dispose calls', () => {
        const el = document.createElement('div')
        let disposeHookCount = 0

        const bp = pipe(
            createContext({}),
            withHook('dispose', () => {
                disposeHookCount++
            })
        )

        const session = mount(bp)(el)
        dispose(session)
        dispose(session)

        expect(disposeHookCount).toBe(1)
        expect(session.isDisposed).toBe(true)
    })
})
