import { describe, expect, it } from 'vitest'
import { Subject } from 'rxjs'
import { DocumentContextError } from '../../domain/model/errors.js'
import type { BlueprintHookEvent, ContextBlueprint, HookRegistration } from '../../domain/model/blueprint.js'
import type { ServiceRegistration } from '../../domain/model/service.js'
import type { Token } from '../../domain/model/token.js'
import type { HostPort } from '../../domain/ports/host.js'
import type { StoragePort } from '../../domain/ports/storage.js'
import type { Session } from '../../domain/model/session.js'
import type { MountSessionRecord } from '../../domain/usecases/mount.js'
import {
    createFakeHost,
    createFakeScheduler,
    createFakeScopeTransport,
} from '../../domain/testing/fakes.js'
import type { FakeScheduler } from '../../domain/testing/fakes.js'
import { createDispose } from './dispose.js'
import type { ApplicationContext } from '../context.js'
import { createMount } from './mount.js'

interface TestWorld {
    readonly ctx: ApplicationContext
    readonly scheduler: FakeScheduler
    readonly keys: Map<unknown, string>
    readonly storages: Map<string, StoragePort>
}

const createWorld = (): TestWorld => {
    const scheduler = createFakeScheduler()
    const world = createFakeScopeTransport()
    const keys = new Map<unknown, string>()
    const storages = new Map<string, StoragePort>()
    const ctx: ApplicationContext = {
        ports: {
            host: {
                toHost: (node: unknown): HostPort => {
                    if (typeof node === 'object' && node !== null
                        && typeof (node as Record<string, unknown>)['native'] === 'function'
                        && typeof (node as Record<string, unknown>)['on'] === 'function') {
                        return node as HostPort
                    }
                    throw new DocumentContextError('HOST_INVALID', { reason: 'not-a-host' })
                },
                scheduler,
                scopeTransport: world.transport,
                tokens: {
                    read: (native: unknown): string | null => keys.get(native) ?? null,
                    write: (native: unknown, token: string | null): void => {
                        if (token === null) {
                            keys.delete(native)
                        } else {
                            keys.set(native, token)
                        }
                    },
                },
            },
            storage: {
                resolve: (keyword: string): StoragePort | null => storages.get(keyword) ?? null,
            },
        },
        sessions: new Map<object, { facade: Session, record: MountSessionRecord<Record<PropertyKey, unknown>> }>(),
        keyed: new Map<string, Session>(),
        records: new WeakMap<object, MountSessionRecord<Record<PropertyKey, unknown>>>(),
        singletons: new Map<string, { status: 'resolved', value: unknown } | { status: 'inflight', promise: Promise<unknown> }>(),
        settled$: new Subject<void>(),
    }
    return { ctx, scheduler, keys, storages }
}

const blueprintOf = <S extends Record<PropertyKey, unknown>>(
    initial: S,
    providers: ReadonlyArray<ServiceRegistration> = [],
    hooks: ReadonlyArray<HookRegistration> = [],
): ContextBlueprint<S> => {
    const map = new Map<Token, ServiceRegistration>()
    for (const registration of providers) {
        map.set(registration.token, registration)
    }
    return { initial, providers: map, hooks, storage: null }
}

const hook = (event: BlueprintHookEvent, handler: (session: unknown) => unknown): HookRegistration => ({
    event,
    handler: handler as unknown as HookRegistration['handler'],
})

const tick = async (rounds = 5): Promise<void> => {
    for (let index = 0; index < rounds; index += 1) {
        await Promise.resolve()
    }
}

describe('dispose two-phase teardown', () => {
    it('fires abort, poisons the store, and pushes disposed in order', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }))(host)
        const order: Array<string> = []
        session.abort$.subscribe(() => {
            order.push('abort')
        })
        session.lifecycle$.subscribe((event) => {
            order.push(event.type)
        })
        let stateCompleted = false
        session.state$.subscribe({ complete: () => { stateCompleted = true } })
        createDispose(ctx)(session)
        expect(order).toEqual(['abort', 'disposed'])
        expect(stateCompleted).toBe(true)
        expect(session.isDisposed).toBe(true)
        expect(session.abortSignal.aborted).toBe(true)
    })

    it('is idempotent and silent for unknown sessions', async () => {
        const { ctx } = createWorld()
        const session = await createMount(ctx)(blueprintOf({ count: 0 }))(createFakeHost({ connected: true }))
        let pulses = 0
        ctx.settled$.subscribe(() => {
            pulses += 1
        })
        createDispose(ctx)(session)
        createDispose(ctx)(session)
        expect(pulses).toBe(1)
        expect(session.isDisposed).toBe(true)
        const foreign = { kind: 'foreign' } as unknown as Session
        expect(() => createDispose(ctx)(foreign)).not.toThrow()
    })

    it('runs sync cleanups LIFO before onDispose LIFO', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const order: Array<string> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', () => () => {
                order.push('cleanup-one')
            }),
            hook('mount', () => () => {
                order.push('cleanup-two')
            }),
            hook('dispose', () => {
                order.push('dispose-one')
            }),
            hook('dispose', () => {
                order.push('dispose-two')
            }),
        ])
        const session = await createMount(ctx)(bp)(host)
        createDispose(ctx)(session)
        expect(order).toEqual(['cleanup-two', 'cleanup-one', 'dispose-two', 'dispose-one'])
    })

    it('sandboxes cleanup and onDispose throws into HOOK_ERROR without stopping teardown', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const order: Array<string> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', () => () => {
                order.push('cleanup-one')
                throw new Error('cleanup-broken')
            }),
            hook('mount', () => () => {
                order.push('cleanup-two')
            }),
            hook('dispose', () => {
                order.push('dispose-one')
                throw new Error('dispose-broken')
            }),
            hook('dispose', () => {
                order.push('dispose-two')
            }),
        ])
        const session = await createMount(ctx)(bp)(host)
        const codes: Array<string> = []
        session.errors$.subscribe((error) => {
            codes.push(error.code)
        })
        createDispose(ctx)(session)
        expect(order).toEqual(['cleanup-two', 'cleanup-one', 'dispose-two', 'dispose-one'])
        expect(codes).toEqual(['HOOK_ERROR', 'HOOK_ERROR'])
        expect(codes.length).toBe(2)
    })

    it('settles async cleanups fire-and-forget and completes errors$ afterwards', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const settled: Array<string> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('dispose', async () => {
                await Promise.resolve()
                settled.push('async-dispose')
            }),
        ])
        const session = await createMount(ctx)(bp)(host)
        let errorsCompleted = false
        session.errors$.subscribe({ complete: () => { errorsCompleted = true } })
        createDispose(ctx)(session)
        expect(settled).toEqual([])
        expect(errorsCompleted).toBe(false)
        await tick()
        expect(settled).toEqual(['async-dispose'])
        expect(errorsCompleted).toBe(true)
    })

    it('routes async cleanup rejections to errors$ while open', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const bp = blueprintOf({ count: 0 }, [], [
            hook('dispose', () => Promise.reject(new Error('async-broken'))),
        ])
        const session = await createMount(ctx)(bp)(host)
        const codes: Array<string> = []
        let errorsCompleted = false
        session.errors$.subscribe({
            next: (error) => {
                codes.push(error.code)
            },
            complete: () => {
                errorsCompleted = true
            },
        })
        createDispose(ctx)(session)
        await tick()
        expect(codes).toEqual(['HOOK_ERROR'])
        expect(errorsCompleted).toBe(true)
    })

    it('clears registries and the keyed write-back on final dispose', async () => {
        const { ctx, keys } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:gone' })(host)
        const native = host.native() as object
        expect(keys.get(native)).toBe('app:gone')
        createDispose(ctx)(session)
        expect(ctx.sessions.get(native)).toBeUndefined()
        expect(ctx.keyed.get('app:gone')).toBeUndefined()
        expect(ctx.records.get(session as unknown as object)).toBeUndefined()
        expect(keys.get(native)).toBeUndefined()
    })

    it('keeps foreign identity write-backs written after the mount', async () => {
        const { ctx, keys } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:session-key' })(host)
        keys.set(host.native(), 'app:foreign-key')
        createDispose(ctx)(session)
        expect(keys.get(host.native())).toBe('app:foreign-key')
    })

    it('tears down the context-request responder', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }, [
            {
                token: 'app:theme',
                factory: () => 'dark',
                lifecycle: 'scoped',
                async: false,
                multi: false,
                eager: false,
            },
        ]))(host)
        createDispose(ctx)(session)
        let calls = 0
        host.dispatch('context-request', {
            detail: { token: 'app:theme', callback: () => { calls += 1 } },
        })
        expect(calls).toBe(0)
    })

    it('cancels armed TTLs and drops suspended entries', async () => {
        const { ctx, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:suspended' })(host)
        host.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(true)
        expect(scheduler.pendingTimeouts()).toBe(1)
        createDispose(ctx)(session)
        expect(scheduler.pendingTimeouts()).toBe(0)
        expect(session.isDisposed).toBe(true)
        scheduler.flushTimeouts()
        expect(session.isDisposed).toBe(true)
    })

    it('drains residual errors to late subscribers after dispose', async () => {
        const { ctx } = createWorld()
        const bp = blueprintOf({ count: 0 }, [
            {
                token: 'app:shared',
                factory: () => ({ id: 1 }),
                lifecycle: 'singleton',
                async: false,
                multi: false,
                eager: false,
            },
        ])
        await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        const loser = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        createDispose(ctx)(loser)
        const codes: Array<string> = []
        let completed = false
        loser.errors$.subscribe({
            next: (error) => {
                codes.push(error.code)
            },
            complete: () => {
                completed = true
            },
        })
        expect(codes).toEqual(['SINGLETON_CONFLICT'])
        expect(completed).toBe(true)
    })

    it('disposes through Symbol.dispose when present', async () => {
        const { ctx } = createWorld()
        const session = await createMount(ctx)(blueprintOf({ count: 0 }))(createFakeHost({ connected: true }))
        const disposable = session as unknown as { readonly [Symbol.dispose]?: () => void }
        if (typeof Symbol.dispose === 'undefined' || disposable[Symbol.dispose] === undefined) {
            return
        }
        disposable[Symbol.dispose]?.()
        expect(session.isDisposed).toBe(true)
    })

    it('awaits async settlement through Symbol.asyncDispose when present', async () => {
        const { ctx } = createWorld()
        const settled: Array<string> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('dispose', async () => {
                await Promise.resolve()
                settled.push('async-cleanup')
            }),
        ])
        const session = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        const disposable = session as unknown as { readonly [Symbol.asyncDispose]?: () => Promise<void> }
        if (typeof Symbol.asyncDispose === 'undefined' || disposable[Symbol.asyncDispose] === undefined) {
            return
        }
        await disposable[Symbol.asyncDispose]?.()
        expect(settled).toEqual(['async-cleanup'])
        expect(session.isDisposed).toBe(true)
    })

    it('tracks async onMount cleanups fire-and-forget with settlement', async () => {
        const { ctx } = createWorld()
        const settled: Array<string> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', () => async () => {
                await Promise.resolve()
                settled.push('async-cleanup')
            }),
        ])
        const session = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        let errorsCompleted = false
        session.errors$.subscribe({ complete: () => { errorsCompleted = true } })
        createDispose(ctx)(session)
        expect(settled).toEqual([])
        expect(errorsCompleted).toBe(false)
        await tick(10)
        expect(settled).toEqual(['async-cleanup'])
        expect(errorsCompleted).toBe(true)
    })

    it('routes async onMount cleanup rejections to errors$ while open', async () => {
        const { ctx } = createWorld()
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', () => async () => {
                await Promise.resolve()
                throw new Error('async-cleanup-broken')
            }),
        ])
        const session = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        const codes: Array<string> = []
        let errorsCompleted = false
        session.errors$.subscribe({
            next: (error) => {
                codes.push(error.code)
            },
            complete: () => {
                errorsCompleted = true
            },
        })
        createDispose(ctx)(session)
        await tick(10)
        expect(codes).toEqual(['HOOK_ERROR'])
        expect(errorsCompleted).toBe(true)
    })

    it('tolerates throwing token reads and writes on teardown', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:teardown' })(host)
        const throwingCtx: ApplicationContext = {
            ...ctx,
            ports: {
                ...ctx.ports,
                host: {
                    ...ctx.ports.host,
                    tokens: {
                        read: (): never => {
                            throw new Error('read-denied')
                        },
                        write: (): void => {},
                    },
                },
            },
        }
        expect(() => createDispose(throwingCtx)(session)).not.toThrow()
        expect(session.isDisposed).toBe(true)
        const second = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:teardown-write' })(createFakeHost({ connected: true }))
        const writeThrowingCtx: ApplicationContext = {
            ...ctx,
            ports: {
                ...ctx.ports,
                host: {
                    ...ctx.ports.host,
                    tokens: {
                        read: () => 'app:teardown-write',
                        write: (): never => {
                            throw new Error('write-denied')
                        },
                    },
                },
            },
        }
        expect(() => createDispose(writeThrowingCtx)(second)).not.toThrow()
        expect(second.isDisposed).toBe(true)
    })

    it('survives kernel dispose failures without interrupting teardown', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }))(host)
        const slot = Symbol.for('document-context.application.session-entry')
        const entry = (session as unknown as Record<symbol, { readonly kernel: { dispose(): void } }>)[slot]
        if (entry === undefined) {
            throw new Error('expected a live session entry')
        }
        entry.kernel.dispose = (): void => {
            throw new Error('kernel-denied')
        }
        const events: Array<string> = []
        session.lifecycle$.subscribe((event) => {
            events.push(event.type)
        })
        expect(() => createDispose(ctx)(session)).not.toThrow()
        // Registries drop and the terminal event fires even though the record
        // never transitioned (the throwing kernel owns that transition).
        expect(ctx.sessions.get(host.native() as object)).toBeUndefined()
        expect(events).toEqual(['disposed'])
    })
})
