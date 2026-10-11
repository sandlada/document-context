import { describe, expect, it, vi } from 'vitest'
import { createContext } from './create-context.js'
import { onAdopt, onDispose, onMount, onResuscitate, onSuspend } from './hooks.js'

describe('lifecycle hook operators', () => {
    const cases = [
        { name: 'onMount', operator: onMount, event: 'mount' },
        { name: 'onDispose', operator: onDispose, event: 'dispose' },
        { name: 'onSuspend', operator: onSuspend, event: 'suspend' },
        { name: 'onResuscitate', operator: onResuscitate, event: 'resuscitate' },
        { name: 'onAdopt', operator: onAdopt, event: 'adopt' },
    ] as const

    for (const { name, operator, event } of cases) {
        it(`${name} appends a ${event} hook without running the handler`, () => {
            const handler = vi.fn((): undefined => undefined)
            const blueprint = operator(handler)(createContext({ count: 0 }))
            expect(handler).not.toHaveBeenCalled()
            expect(blueprint.hooks).toHaveLength(1)
            const [registration] = blueprint.hooks
            expect(registration?.event).toBe(event)
            expect(registration?.handler).toBe(handler)
        })
    }

    it('onResuscitate keeps a two-argument session-plus-host handler', () => {
        const handler = vi.fn((_session: unknown, _host: unknown): undefined => undefined)
        const blueprint = onResuscitate(handler)(createContext({ count: 0 }))
        expect(handler).not.toHaveBeenCalled()
        const [registration] = blueprint.hooks
        expect(registration?.event).toBe('resuscitate')
        expect(registration?.handler).toBe(handler)
    })

    it('onAdopt keeps a session-plus-owner handler', () => {
        const handler = vi.fn((_session: unknown, _owner: unknown): undefined => undefined)
        const blueprint = onAdopt(handler)(createContext({ count: 0 }))
        expect(handler).not.toHaveBeenCalled()
        const [registration] = blueprint.hooks
        expect(registration?.event).toBe('adopt')
        expect(registration?.handler).toBe(handler)
    })

    it('onDispose keeps an async handler', () => {
        const handler = vi.fn(async (): Promise<void> => undefined)
        const blueprint = onDispose(handler)(createContext({ count: 0 }))
        expect(handler).not.toHaveBeenCalled()
        const [registration] = blueprint.hooks
        expect(registration?.event).toBe('dispose')
        expect(registration?.handler).toBe(handler)
    })

    it('preserves registration order across mixed hooks', () => {
        const seed = createContext({ count: 0 })
        const noop = (): undefined => undefined
        const blueprint = onAdopt(noop)(onResuscitate(noop)(onSuspend(noop)(onDispose(noop)(onMount(noop)(seed)))))
        expect(blueprint.hooks.map((hook) => hook.event)).toEqual(['mount', 'dispose', 'suspend', 'resuscitate', 'adopt'])
    })

    it('returns a new blueprint and leaves the input hooks untouched', () => {
        const input = createContext({ count: 0 })
        const noop = (): undefined => undefined
        const output = onMount(noop)(input)
        expect(output).not.toBe(input)
        expect(output.hooks).not.toBe(input.hooks)
        expect(input.hooks).toEqual([])
        expect(output.initial).toBe(input.initial)
        expect(output.providers).toBe(input.providers)
        expect(output.storage).toBe(input.storage)
    })
})
