import { describe, expect, it } from 'vitest'
import { DocumentContextError } from './errors.js'
import { createServiceRegistry } from './service.js'
import { definePrivateToken } from './token.js'
import type { ServiceLifecycle, ServiceRegistration } from './service.js'

const single = (
    token: string,
    lifecycle: ServiceLifecycle = 'scoped',
    value: unknown = { ok: true },
): ServiceRegistration => ({
    token,
    factory: () => value,
    lifecycle,
    async: false,
    multi: false,
    eager: false,
})

const multi = (token: string, value: unknown = { ok: true }): ServiceRegistration => ({
    ...single(token, 'scoped', value),
    multi: true,
})

const deferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

describe('createServiceRegistry register', () => {
    it('registers a single provider as added without executing the factory', () => {
        const registry = createServiceRegistry()
        let calls = 0
        const reg: ServiceRegistration = {
            ...single('app:user'),
            factory: () => {
                calls += 1
                return { id: 'u1' }
            },
        }
        expect(registry.register(reg)).toBe('added')
        expect(registry.size()).toBe(1)
        expect(calls).toBe(0)
    })

    it('lets a later single registration overwrite the earlier one', () => {
        const registry = createServiceRegistry()
        expect(registry.register(single('app:user', 'scoped', { v: 1 }))).toBe('added')
        expect(registry.register(single('app:user', 'scoped', { v: 2 }))).toBe('overwritten')
        expect(registry.size()).toBe(1)
    })

    it('accumulates multi registrations under one key', () => {
        const registry = createServiceRegistry()
        expect(registry.register(multi('app:mw', { v: 1 }))).toBe('multi-added')
        expect(registry.register(multi('app:mw', { v: 2 }))).toBe('multi-added')
        expect(registry.size()).toBe(1)
    })

    it('lets single and multi registrations coexist under one key', () => {
        const registry = createServiceRegistry()
        expect(registry.register(single('app:mixed'))).toBe('added')
        expect(registry.register(multi('app:mixed'))).toBe('multi-added')
        expect(registry.register(multi('app:mixed'))).toBe('multi-added')
        expect(registry.size()).toBe(1)
    })

    it('keeps the first registration on singleton conflicts', () => {
        const registry = createServiceRegistry()
        expect(registry.register(single('app:s1', 'singleton', { v: 1 }))).toBe('added')
        expect(registry.register(single('app:s1', 'singleton', { v: 2 }))).toBe('singleton-kept')
        expect(registry.size()).toBe(1)
    })

    it('keeps the first registration when either side of an overwrite is a singleton', () => {
        const scopedFirst = createServiceRegistry()
        expect(scopedFirst.register(single('app:s2', 'scoped'))).toBe('added')
        expect(scopedFirst.register(single('app:s2', 'singleton'))).toBe('singleton-kept')

        const singletonFirst = createServiceRegistry()
        expect(singletonFirst.register(single('app:s3', 'singleton'))).toBe('added')
        expect(singletonFirst.register(single('app:s3', 'scoped'))).toBe('singleton-kept')
    })

    it('keeps distinct keys independent across register and evict', () => {
        const registry = createServiceRegistry()
        registry.register(single('app:a'))
        registry.register(single('app:b'))
        expect(registry.size()).toBe(2)
        registry.evict('app:a')
        expect(registry.size()).toBe(1)
        registry.evict('app:missing')
        expect(registry.size()).toBe(1)
    })

    it('keys private tokens by reference identity', () => {
        const registry = createServiceRegistry()
        const first = definePrivateToken('app:secret')
        const second = definePrivateToken('app:secret')
        expect(registry.register({ ...single('app:ignored'), token: first })).toBe('added')
        expect(registry.register({ ...single('app:ignored'), token: second })).toBe('added')
        expect(registry.register({ ...single('app:ignored'), token: first })).toBe('overwritten')
        expect(registry.size()).toBe(2)
    })
})

describe('createServiceRegistry resolveSync', () => {
    it('returns the invoke result and calls invoke exactly once', () => {
        const registry = createServiceRegistry()
        let calls = 0
        const result = registry.resolveSync('app:user', () => {
            calls += 1
            return { id: 'u1' }
        })
        expect(result).toEqual({ id: 'u1' })
        expect(calls).toBe(1)
    })

    it('throws CIRCULAR_DEPENDENCY on synchronous same-key re-entry', () => {
        const registry = createServiceRegistry()
        const attempt = (): unknown => registry.resolveSync('app:loop', () => 'inner')
        try {
            registry.resolveSync('app:loop', attempt)
            throw new Error('expected CIRCULAR_DEPENDENCY')
        } catch (error) {
            expect(error).toBeInstanceOf(DocumentContextError)
            const contextError = error as DocumentContextError
            expect(contextError.code).toBe('CIRCULAR_DEPENDENCY')
            expect(contextError.details).toEqual({ token: 'app:loop' })
        }
        expect(registry.resolveSync('app:loop', () => 'recovered')).toBe('recovered')
    })

    it('allows nested resolution of different keys', () => {
        const registry = createServiceRegistry()
        const result = registry.resolveSync('app:a', () => registry.resolveSync('app:b', () => 'b-value'))
        expect(result).toBe('b-value')
    })

    it('clears the re-entry guard when invoke throws', () => {
        const registry = createServiceRegistry()
        expect(() => registry.resolveSync('app:c', () => {
            throw new Error('factory-boom')
        })).toThrow('factory-boom')
        expect(registry.resolveSync('app:c', () => 'recovered')).toBe('recovered')
    })
})

describe('createServiceRegistry resolveAsync', () => {
    it('coalesces concurrent resolutions to one promise and one invoke', async () => {
        const registry = createServiceRegistry()
        const gate = deferred<string>()
        let calls = 0
        const first = registry.resolveAsync('app:co', () => {
            calls += 1
            return gate.promise
        })
        const second = registry.resolveAsync('app:co', () => {
            calls += 1
            return Promise.resolve('late')
        })
        expect(second).toBe(first)
        expect(calls).toBe(1)
        gate.resolve('first')
        await expect(first).resolves.toBe('first')
        await expect(second).resolves.toBe('first')
        expect(calls).toBe(1)
    })

    it('retains the resolved promise so later calls coalesce without re-invoking', async () => {
        const registry = createServiceRegistry()
        let calls = 0
        const first = registry.resolveAsync('app:kept', () => {
            calls += 1
            return Promise.resolve('value')
        })
        await expect(first).resolves.toBe('value')
        const second = registry.resolveAsync('app:kept', () => {
            calls += 1
            return Promise.resolve('other')
        })
        expect(second).toBe(first)
        expect(calls).toBe(1)
    })

    it('coalesces await-crossed re-entries to the same in-flight promise', async () => {
        const registry = createServiceRegistry()
        const gate = deferred<string>()
        let calls = 0
        const first = registry.resolveAsync('app:cycle', () => {
            calls += 1
            return gate.promise
        })
        await Promise.resolve()
        const second = registry.resolveAsync('app:cycle', () => {
            calls += 1
            return Promise.resolve('late')
        })
        expect(second).toBe(first)
        expect(calls).toBe(1)
        gate.resolve('settled')
        await expect(first).resolves.toBe('settled')
    })

    it('evicts rejections so a retry re-invokes', async () => {
        const registry = createServiceRegistry()
        let calls = 0
        await expect(registry.resolveAsync('app:flaky', () => {
            calls += 1
            return Promise.reject(new Error('boom-1'))
        })).rejects.toThrow('boom-1')
        expect(calls).toBe(1)
        await expect(registry.resolveAsync('app:flaky', () => {
            calls += 1
            return Promise.resolve('recovered')
        })).resolves.toBe('recovered')
        expect(calls).toBe(2)
    })

    it('maps a synchronous invoke throw to a rejection without caching', async () => {
        const registry = createServiceRegistry()
        let calls = 0
        await expect(registry.resolveAsync('app:sync-throw', (): unknown => {
            calls += 1
            throw new Error('sync-boom')
        })).rejects.toThrow('sync-boom')
        await expect(registry.resolveAsync('app:sync-throw', () => {
            calls += 1
            return Promise.resolve('recovered')
        })).resolves.toBe('recovered')
        expect(calls).toBe(2)
    })

    it('surfaces sync-immediate async re-entry as a CIRCULAR_DEPENDENCY rejection', async () => {
        const registry = createServiceRegistry()
        const outer = registry.resolveAsync(
            'app:loop',
            () => registry.resolveAsync('app:loop', () => Promise.resolve('inner')),
        )
        await expect(outer).rejects.toMatchObject({ code: 'CIRCULAR_DEPENDENCY' })
    })

    it('lets an async invoke nest a synchronous resolution of a different key', async () => {
        const registry = createServiceRegistry()
        const result = await registry.resolveAsync(
            'app:outer',
            () => registry.resolveSync('app:inner', () => 'inner-value') as unknown,
        )
        expect(result).toBe('inner-value')
    })

    it('evict drops registrations and in-flight entries', async () => {
        const registry = createServiceRegistry()
        registry.register(single('app:gone'))
        const gate = deferred<string>()
        let calls = 0
        const first = registry.resolveAsync('app:gone', () => {
            calls += 1
            return gate.promise
        })
        registry.evict('app:gone')
        expect(registry.size()).toBe(0)
        const second = registry.resolveAsync('app:gone', () => {
            calls += 1
            return Promise.resolve('fresh')
        })
        expect(second).not.toBe(first)
        expect(calls).toBe(2)
        gate.resolve('stale')
        await expect(first).resolves.toBe('stale')
        await expect(second).resolves.toBe('fresh')
    })

    it('keeps a replacement entry when a rejection settles after evict (stale eviction is a no-op)', async () => {
        const registry = createServiceRegistry()
        const gate = deferred<string>()
        let calls = 0
        const first = registry.resolveAsync('app:flaky', () => {
            calls += 1
            return gate.promise
        })
        registry.evict('app:flaky')
        const second = registry.resolveAsync('app:flaky', () => {
            calls += 1
            return Promise.resolve('fresh')
        })
        expect(second).not.toBe(first)
        expect(calls).toBe(2)
        gate.reject(new Error('stale-boom'))
        await expect(first).rejects.toThrow('stale-boom')
        await expect(second).resolves.toBe('fresh')
        const third = registry.resolveAsync('app:flaky', () => {
            calls += 1
            return Promise.resolve('other')
        })
        expect(third).toBe(second)
        expect(calls).toBe(2)
    })
})
