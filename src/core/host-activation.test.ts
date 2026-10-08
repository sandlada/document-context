import { describe, expect, it } from 'vitest'
import {
    rebindHostActivations,
    registerHostActivation,
    teardownHostActivations
} from './host-activation'
import type { ISession } from './types'

function fakeSession(el: HTMLElement): ISession<any, any> {
    return { target: el } as unknown as ISession<any, any>
}

describe('host-activation', () => {
    it('binds immediately on registration and stores the cleanup', () => {
        const el = document.createElement('div')
        const session = fakeSession(el)
        const bound: HTMLElement[] = []
        let cleaned = 0

        registerHostActivation(session, {
            bind: (target) => {
                bound.push(target)
                return () => {
                    cleaned++
                }
            }
        })

        expect(bound).toEqual([el])
        expect(cleaned).toBe(0)

        teardownHostActivations(session)
        expect(cleaned).toBe(1)
    })

    it('tears down the previous binding before rebinding to a new target', () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        const session = fakeSession(el1)
        const events: string[] = []

        registerHostActivation(session, {
            bind: (target) => {
                const label = target === el1 ? 'el1' : 'el2'
                events.push(`bind:${label}`)
                return () => {
                    events.push(`cleanup:${label}`)
                }
            }
        })

        rebindHostActivations(session, el2)

        expect(events).toEqual(['bind:el1', 'cleanup:el1', 'bind:el2'])
    })

    it('tears down multiple activations in reverse registration order', () => {
        const el = document.createElement('div')
        const session = fakeSession(el)
        const order: string[] = []

        registerHostActivation(session, {
            bind: () => () => {
                order.push('first')
            }
        })
        registerHostActivation(session, {
            bind: () => () => {
                order.push('second')
            }
        })

        teardownHostActivations(session)
        expect(order).toEqual(['second', 'first'])

        // Second teardown is a safe no-op
        teardownHostActivations(session)
        expect(order).toEqual(['second', 'first'])
    })

    it('rebinds every activation to the new target', () => {
        const el1 = document.createElement('div')
        const el2 = document.createElement('div')
        const session = fakeSession(el1)
        const boundTargets: HTMLElement[] = []

        registerHostActivation(session, { bind: () => {} })
        registerHostActivation(session, {
            bind: (target) => {
                boundTargets.push(target)
            }
        })

        rebindHostActivations(session, el2)

        expect(boundTargets).toEqual([el1, el2])
    })
})
