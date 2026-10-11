import { describe, expect, it, vi } from 'vitest'
import { DocumentContextError } from '../../domain/model/errors.js'
import { definePrivateToken, defineToken } from '../../domain/model/token.js'
import { createContext } from './create-context.js'
import { provide, provideSync } from './provide.js'

describe('provide', () => {
    it('registers an async provider with scoped, non-multi, lazy defaults', () => {
        const token = defineToken<{ id: string }>('app:user')
        const blueprint = provide(token, async () => ({ id: 'u1' }))(createContext({ count: 0 }))
        const registration = blueprint.providers.get(token)
        expect(registration).toBeDefined()
        expect(registration?.token).toBe(token)
        expect(registration?.async).toBe(true)
        expect(registration?.lifecycle).toBe('scoped')
        expect(registration?.multi).toBe(false)
        expect(registration?.eager).toBe(false)
    })

    it('honours explicit lifecycle, multi, and eager options', () => {
        const token = defineToken<string>('app:tag')
        const blueprint = provide(token, async () => 'a', { lifecycle: 'singleton', multi: true, eager: true })(
            createContext({ count: 0 }),
        )
        const registration = blueprint.providers.get(token)
        expect(registration?.lifecycle).toBe('singleton')
        expect(registration?.multi).toBe(true)
        expect(registration?.eager).toBe(true)
    })

    it('never executes the factory during registration', () => {
        const token = defineToken<string>('app:lazy')
        const factory = vi.fn(async () => 'value')
        provide(token, factory)(createContext({ count: 0 }))
        expect(factory).not.toHaveBeenCalled()
    })

    it('passes the mount session through to the factory when invoked', async () => {
        const token = defineToken<string>('app:echo')
        const blueprint = provide(token, async (session) => JSON.stringify(session))(createContext({ count: 0 }))
        const registration = blueprint.providers.get(token)
        const fakeSession = { count: 0 }
        await expect(registration?.factory(fakeSession)).resolves.toBe(JSON.stringify(fakeSession))
    })

    it('returns a new blueprint and leaves the input untouched', () => {
        const token = defineToken<string>('app:fresh')
        const input = createContext({ count: 0 })
        const output = provide(token, async () => 'value')(input)
        expect(output).not.toBe(input)
        expect(output.providers).not.toBe(input.providers)
        expect(input.providers.size).toBe(0)
        expect(output.providers.size).toBe(1)
        expect(output.initial).toBe(input.initial)
        expect(output.hooks).toBe(input.hooks)
        expect(output.storage).toBe(input.storage)
    })

    it('lets a later single registration overwrite the same-token single', async () => {
        const token = defineToken<string>('app:winner')
        const seed = createContext({ count: 0 })
        const first = provide(token, async () => 'first')(seed)
        const second = provide(token, async () => 'second')(first)
        expect(second.providers.size).toBe(1)
        expect(first.providers.size).toBe(1)
        const registration = second.providers.get(token)
        await expect(registration?.factory({})).resolves.toBe('second')
    })

    it('replaces the map entry when multi is provided twice for one token', async () => {
        // Domain ContextBlueprint.providers is a single ReadonlyMap<Token,
        // ServiceRegistration>: one entry per token. Blueprint-level repeats
        // therefore keep the latest entry; registry-level accumulation applies
        // to the entries mount receives.
        const token = defineToken<string>('app:tag')
        const seed = createContext({ count: 0 })
        const first = provide(token, async () => 'a', { multi: true })(seed)
        const second = provide(token, async () => 'b', { multi: true })(first)
        expect(second.providers.size).toBe(1)
        const registration = second.providers.get(token)
        expect(registration?.multi).toBe(true)
        await expect(registration?.factory({})).resolves.toBe('b')
    })

    it('validates bare string tokens and throws TOKEN_INVALID without a namespace', () => {
        const seed = createContext({ count: 0 })
        let caught: unknown
        try {
            provide('plain', async () => 'value')(seed)
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(DocumentContextError)
        expect((caught as DocumentContextError).code).toBe('TOKEN_INVALID')
    })

    it('accepts branded tokens by string equality across definitions', () => {
        const first = defineToken<string>('app:shared')
        const second = defineToken<string>('app:shared')
        const blueprint = provide(first, async () => 'value')(createContext({ count: 0 }))
        expect(blueprint.providers.get(second)?.token).toBe('app:shared')
    })

    it('passes private tokens through exempt from namespace validation', () => {
        const secret = definePrivateToken<string>('not-a-namespaced-name')
        const blueprint = provide(secret, async () => 'shh')(createContext({ count: 0 }))
        const registration = blueprint.providers.get(secret)
        expect(registration?.token).toBe(secret)
        expect(registration?.async).toBe(true)
    })
})

describe('provideSync', () => {
    it('registers a sync provider with async false and scoped defaults', () => {
        const token = defineToken<{ log: (message: string) => void }>('app:logger')
        const blueprint = provideSync(token, () => ({ log: () => undefined }))(createContext({ count: 0 }))
        const registration = blueprint.providers.get(token)
        expect(registration?.async).toBe(false)
        expect(registration?.lifecycle).toBe('scoped')
        expect(registration?.multi).toBe(false)
        expect(registration?.eager).toBe(false)
    })

    it('never executes the factory during registration', () => {
        const token = defineToken<string>('app:sync-lazy')
        const factory = vi.fn(() => 'value')
        provideSync(token, factory)(createContext({ count: 0 }))
        expect(factory).not.toHaveBeenCalled()
    })

    it('passes the session through to the sync factory when invoked', () => {
        const token = defineToken<number>('app:count')
        const blueprint = provideSync(token, (session) => (session as unknown as { count: number }).count)(
            createContext({ count: 7 }),
        )
        const registration = blueprint.providers.get(token)
        expect(registration?.factory({ count: 7 })).toBe(7)
    })

    it('validates string tokens the same way provide does', () => {
        const seed = createContext({ count: 0 })
        let caught: unknown
        try {
            provideSync('plain', () => 'value')(seed)
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(DocumentContextError)
        expect((caught as DocumentContextError).code).toBe('TOKEN_INVALID')
    })

    it('lets a later registration overwrite the same-token entry', () => {
        const token = defineToken<string>('app:sync-winner')
        const seed = createContext({ count: 0 })
        const first = provideSync(token, () => 'first')(seed)
        const second = provideSync(token, () => 'second')(first)
        expect(second.providers.size).toBe(1)
        expect(second.providers.get(token)?.factory({})).toBe('second')
    })
})
