import { describe, expect, it } from 'vitest'
import type { BlueprintHookEvent, ContextBlueprint, HookRegistration } from './blueprint.js'

describe('ContextBlueprint', () => {
    it('holds initial state, providers, hooks, and storage', () => {
        const blueprint: ContextBlueprint<{ count: number }> = {
            initial: { count: 0 },
            providers: new Map(),
            hooks: [],
            storage: null,
        }
        expect(blueprint.initial).toEqual({ count: 0 })
        expect(blueprint.providers).toBeInstanceOf(Map)
        expect(blueprint.providers.size).toBe(0)
        expect(blueprint.hooks).toEqual([])
        expect(blueprint.storage).toBeNull()
    })

    it('accepts every hook event and preserves hook order', () => {
        const events: ReadonlyArray<BlueprintHookEvent> = ['mount', 'dispose', 'suspend', 'resuscitate', 'adopt']
        const hooks: ReadonlyArray<HookRegistration> = events.map((event) => ({
            event,
            handler: () => 'handled',
        }))
        const blueprint: ContextBlueprint = {
            initial: {},
            providers: new Map(),
            hooks,
            storage: null,
        }
        expect(blueprint.hooks.map((hook) => hook.event)).toEqual([...events])
        for (const hook of blueprint.hooks) {
            expect(hook.handler()).toBe('handled')
        }
    })

    it('exposes readonly fields (compile-time immutability)', () => {
        const blueprint: ContextBlueprint = {
            initial: {},
            providers: new Map(),
            hooks: [],
            storage: null,
        }
        // @ts-expect-error - initial is readonly
        blueprint.initial = {}
        // @ts-expect-error - providers is readonly
        blueprint.providers = new Map()
        // @ts-expect-error - hooks is readonly
        blueprint.hooks = []
        // @ts-expect-error - storage is readonly
        blueprint.storage = null
        expect(blueprint).toBeDefined()
    })
})
