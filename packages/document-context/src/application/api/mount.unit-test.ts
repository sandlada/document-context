import { describe, expect, it, vi } from 'vitest'
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
    createFakeStorage,
} from '../../domain/testing/fakes.js'
import type { FakeHost, FakeScheduler, FakeStorageHandle } from '../../domain/testing/fakes.js'
import { createDispose } from './dispose.js'
import { createMount, createMountSync } from './mount.js'
import type { ApplicationContext } from '../context.js'

declare module '../../domain/ports/storage.js' {
    interface StorageKeywords {
        readonly memory?: true
        readonly asyncMemory?: true
    }
}

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
    storage: ContextBlueprint<S>['storage'] = null,
): ContextBlueprint<S> => {
    const map = new Map<Token, ServiceRegistration>()
    for (const registration of providers) {
        map.set(registration.token, registration)
    }
    return { initial, providers: map, hooks, storage }
}

const provider = (
    token: string,
    factory: (session: unknown) => unknown,
    options?: { readonly lifecycle?: 'singleton' | 'scoped' | 'transient', readonly async?: boolean, readonly multi?: boolean, readonly eager?: boolean },
): ServiceRegistration => ({
    token,
    factory: factory as (session: unknown) => unknown | Promise<unknown>,
    lifecycle: options?.lifecycle ?? 'scoped',
    async: options?.async ?? false,
    multi: options?.multi ?? false,
    eager: options?.eager ?? false,
})

const hook = (event: BlueprintHookEvent, handler: (session: unknown) => unknown): HookRegistration => ({
    event,
    handler: handler as unknown as HookRegistration['handler'],
})

const snapshotOf = <S extends Record<PropertyKey, unknown>>(session: Session<S, unknown>): S => {
    let current!: S
    session.state$.subscribe((state) => {
        current = state
    }).unsubscribe()
    return current
}

const envelope = (state: unknown, version = 0): string => JSON.stringify({ v: version, d: state })

const tick = async (rounds = 5): Promise<void> => {
    for (let index = 0; index < rounds; index += 1) {
        await Promise.resolve()
    }
}

describe('mount basics', () => {
    it('mounts an anonymous session with seed state and hot streams', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }))(host)
        expect(session.token).toBeNull()
        expect(session.isConnected).toBe(true)
        expect(session.isSuspended).toBe(false)
        expect(session.isDisposed).toBe(false)
        expect(snapshotOf(session)).toEqual({ count: 0 })
        expect(session.abortSignal.aborted).toBe(false)
    })

    it('rejects UNCONNECTED_NODE for disconnected hosts', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: false })
        const error = await createMount(ctx)(blueprintOf({ count: 0 }))(host).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('UNCONNECTED_NODE')
        expect((error as DocumentContextError).details).toMatchObject({ connected: false })
    })

    it('rejects HOST_INVALID for non-host targets', async () => {
        const { ctx } = createWorld()
        const error = await createMount(ctx)(blueprintOf({ count: 0 }))({} as unknown as FakeHost).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('HOST_INVALID')
    })

    it('exempts the ssr nullHost from the connectivity gate and hydrates its payload', async () => {
        const { ctx } = createWorld()
        const nullHost = createFakeHost({ connected: false })
        const withSsr: ApplicationContext = {
            ...ctx,
            ports: {
                ...ctx.ports,
                ssr: {
                    nullHost,
                    payloadResolver: () => ({ count: 7 }),
                    serialize: () => () => '{}',
                },
            },
        }
        const session = await createMount(withSsr)(blueprintOf({ count: 0 }))(nullHost)
        expect(session.isConnected).toBe(false)
        expect(snapshotOf(session)).toEqual({ count: 7 })
    })

    it('rejects TOKEN_INVALID for malformed options tokens', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const error = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'no-namespace' })(host).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('TOKEN_INVALID')
    })

    it('rejects TOKEN_INVALID for non-string keyed identities', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const error = await createMount(ctx)(
            blueprintOf({ count: 0 }),
            { token: { name: 'app:box' } as unknown as string },
        )(host).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('TOKEN_INVALID')
    })

    it('prefers options.token over the adapter and writes it back', async () => {
        const { ctx, keys } = createWorld()
        const host = createFakeHost({ connected: true })
        keys.set(host.native(), 'app:from-adapter')
        const session = await createMount(ctx)(
            blueprintOf({ count: 0 }),
            { token: 'app:from-options', onConflict: 'evict' },
        )(host)
        expect(session.token).toBe('app:from-options')
        expect(keys.get(host.native())).toBe('app:from-options')
    })

    it('falls back to the adapter identity and validates it', async () => {
        const { ctx, keys } = createWorld()
        const host = createFakeHost({ connected: true })
        keys.set(host.native(), 'app:adapter-only')
        const session = await createMount(ctx)(blueprintOf({ count: 0 }))(host)
        expect(session.token).toBe('app:adapter-only')
        expect(keys.get(host.native())).toBe('app:adapter-only')
    })

    it('throws KEYED_SESSION_CONFLICT when options.token contradicts the adapter key', async () => {
        const { ctx, keys } = createWorld()
        const host = createFakeHost({ connected: true })
        keys.set(host.native(), 'app:adapter-key')
        const error = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:other-key' })(host).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('KEYED_SESSION_CONFLICT')
    })

    it('pulses settled$ on success and on failure', async () => {
        const { ctx } = createWorld()
        let pulses = 0
        ctx.settled$.subscribe(() => {
            pulses += 1
        })
        await createMount(ctx)(blueprintOf({ count: 0 }))(createFakeHost({ connected: true }))
        await createMount(ctx)(blueprintOf({ count: 0 }))(createFakeHost({ connected: false })).then(
            () => undefined,
            () => undefined,
        )
        expect(pulses).toBe(2)
    })
})

describe('mount idempotency and in-flight coalescing', () => {
    it('returns the cached facade with first-blueprint-wins on repeat mounts', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const first = await createMount(ctx)(blueprintOf({ count: 1 }))(host)
        const second = await createMount(ctx)(blueprintOf({ count: 2 }))(host)
        expect(second).toBe(first)
        expect(snapshotOf(first)).toEqual({ count: 1 })
    })

    it('coalesces concurrent same-host mounts into one session and one eager run', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        let calls = 0
        let resolveGate!: (value: string) => void
        const gate = new Promise<string>((resolve) => {
            resolveGate = resolve
        })
        const bp = blueprintOf({ count: 0 }, [
            provider('app:eager', () => {
                calls += 1
                return gate
            }, { async: true, eager: true }),
        ])
        const mount = createMount(ctx)(bp)
        const pendingFirst = mount(host)
        const pendingSecond = mount(host)
        resolveGate('ready')
        const [first, second] = await Promise.all([pendingFirst, pendingSecond])
        expect(second).toBe(first)
        expect(calls).toBe(1)
        expect(first.isDisposed).toBe(false)
    })

    it('lets the first mounted session win a cross-host race; the loser takes KEYED_SESSION_CONFLICT', async () => {
        const { ctx } = createWorld()
        const hostA = createFakeHost({ connected: true })
        const hostB = createFakeHost({ connected: true })
        const bp = blueprintOf({ count: 0 })
        const pendingA = createMount(ctx)(bp, { token: 'app:race' })(hostA)
        const pendingB = createMount(ctx)(bp, { token: 'app:race' })(hostB)
        const winner = await pendingA
        const loser = await pendingB.then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(winner.token).toBe('app:race')
        expect(loser).toBeInstanceOf(DocumentContextError)
        expect((loser as DocumentContextError).code).toBe('KEYED_SESSION_CONFLICT')
    })

    it('throws genuine dual-active conflicts even under onConflict evict', async () => {
        const { ctx } = createWorld()
        const hostA = createFakeHost({ connected: true })
        const hostB = createFakeHost({ connected: true })
        await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:live' })(hostA)
        const error = await createMount(ctx)(
            blueprintOf({ count: 0 }),
            { token: 'app:live', onConflict: 'evict' },
        )(hostB).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('KEYED_SESSION_CONFLICT')
    })
})

describe('mount onConflict swaps', () => {
    it('throws by default on same-host token swaps', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:first' })(host)
        const error = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:second' })(host).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('KEYED_SESSION_CONFLICT')
    })

    it('evicts the old session before mounting the new identity', async () => {
        const { ctx, keys } = createWorld()
        const host = createFakeHost({ connected: true })
        const events: Array<string> = []
        const firstBp = blueprintOf({ count: 0 }, [], [
            hook('dispose', () => {
                events.push('disposed-first')
            }),
        ])
        const first = await createMount(ctx)(firstBp, { token: 'app:first' })(host)
        const second = await createMount(ctx)(
            blueprintOf({ count: 9 }),
            { token: 'app:second', onConflict: 'evict' },
        )(host)
        expect(first.isDisposed).toBe(true)
        expect(second.token).toBe('app:second')
        expect(snapshotOf(second)).toEqual({ count: 9 })
        expect(events).toEqual(['disposed-first'])
        expect(keys.get(host.native())).toBe('app:second')
    })

    it('resets the seed from the live snapshot of the evicted session', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const first = await createMount(ctx)(blueprintOf({ count: 4 }), { token: 'app:first' })(host)
        const second = await createMount(ctx)(
            blueprintOf({ count: 0 }),
            { token: 'app:second', onConflict: 'reset' },
        )(host)
        expect(first.isDisposed).toBe(true)
        expect(snapshotOf(second)).toEqual({ count: 4 })
    })
})

describe('mount cancellation', () => {
    it('rejects with signal.reason on pre-entry abort without touching registries', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        let calls = 0
        let resolveGate!: (value: string) => void
        const gate = new Promise<string>((resolve) => {
            resolveGate = resolve
        })
        const bp = blueprintOf({ count: 0 }, [
            provider('app:eager', () => {
                calls += 1
                return gate
            }, { async: true, eager: true }),
        ])
        const controller = new AbortController()
        const pending = createMount(ctx)(bp, { signal: controller.signal })(host)
        controller.abort(new Error('stop-early'))
        const error = await pending.then(
            () => null,
            (reason: unknown) => reason,
        )
        expect((error as Error).message).toBe('stop-early')
        expect(calls).toBe(0)
        expect(ctx.sessions.get(host.native() as object)).toBeUndefined()
        resolveGate('late')
    })

    it('rejects with signal.reason on in-flight abort and cleans the entry', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        let resolveGate!: (value: string) => void
        const gate = new Promise<string>((resolve) => {
            resolveGate = resolve
        })
        const bp = blueprintOf({ count: 0 }, [
            provider('app:eager', () => gate, { async: true, eager: true }),
        ])
        const controller = new AbortController()
        const pending = createMount(ctx)(bp, { signal: controller.signal })(host)
        await Promise.resolve()
        await Promise.resolve()
        controller.abort(new Error('stop-late'))
        const error = await pending.then(
            () => null,
            (reason: unknown) => reason,
        )
        expect((error as Error).message).toBe('stop-late')
        resolveGate('late')
        await Promise.resolve()
        expect(ctx.sessions.get(host.native() as object)).toBeUndefined()
    })

    it('rejects immediately when the signal is already aborted', async () => {
        const { ctx } = createWorld()
        const controller = new AbortController()
        controller.abort(new Error('already'))
        const error = await createMount(ctx)(
            blueprintOf({ count: 0 }),
            { signal: controller.signal },
        )(createFakeHost({ connected: true })).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect((error as Error).message).toBe('already')
    })
})

describe('mount hydration', () => {
    it('hydrates before eager instantiation so eager sees hydrated state', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:counter', envelope({ count: 41 }))
        storages.set('memory', storage.port)
        const host = createFakeHost({ connected: true })
        let observed = -1
        const bp = blueprintOf({ count: 0 }, [
            provider('app:eager', (session: unknown) => {
                observed = snapshotOf(session as Session<{ count: number }, unknown>).count
                return 'eager-done'
            }, { eager: true }),
        ], [], { storage: 'memory', key: 'app:counter' })
        const session = await createMount(ctx)(bp)(host)
        expect(observed).toBe(41)
        expect(snapshotOf(session)).toEqual({ count: 41 })
    })

    it('falls back to the seed and buffers INVALID_STORAGE_DATA on corrupt payloads', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:counter', 'not-json{{{')
        storages.set('memory', storage.port)
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(
            blueprintOf({ count: 3 }, [], [], { storage: 'memory', key: 'app:counter' }),
        )(host)
        expect(snapshotOf(session)).toEqual({ count: 3 })
        const codes: Array<string> = []
        session.errors$.subscribe((error) => {
            codes.push(error.code)
        })
        expect(codes).toEqual(['INVALID_STORAGE_DATA'])
    })

    it('rejects UNKNOWN_SERVICE for unregistered storage keywords', async () => {
        const { ctx } = createWorld()
        const error = await createMount(ctx)(
            blueprintOf({ count: 0 }, [], [], { storage: 'missingBackend' as unknown as 'memory', key: 'app:k' }),
        )(createFakeHost({ connected: true })).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('UNKNOWN_SERVICE')
    })

    it('rejects eager failures with the bare reason and no errors$ push', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const boom = new Error('eager-boom')
        const bp = blueprintOf({ count: 0 }, [
            provider('app:eager', () => Promise.reject(boom), { async: true, eager: true }),
        ])
        const error = await createMount(ctx)(bp)(host).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBe(boom)
        expect(ctx.sessions.get(host.native() as object)).toBeUndefined()
    })
})

describe('mount hooks and lifecycle order', () => {
    it('runs onMount FIFO before the mounted event', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const order: Array<string> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', (session: unknown) => {
                order.push('hook-one')
                ;(session as Session).lifecycle$.subscribe((event) => {
                    order.push(event.type)
                })
            }),
            hook('mount', () => {
                order.push('hook-two')
            }),
        ])
        await createMount(ctx)(bp)(host)
        expect(order).toEqual(['hook-one', 'hook-two', 'mounted'])
    })

    it('fails the mount on onMount throw after running earlier cleanups', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const cleaned: Array<number> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', () => () => {
                cleaned.push(1)
            }),
            hook('mount', () => {
                throw new Error('mount-broken')
            }),
        ])
        const error = await createMount(ctx)(bp)(host).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('HOOK_ERROR')
        expect(cleaned).toEqual([1])
        expect(ctx.sessions.get(host.native() as object)).toBeUndefined()
    })

    it('awaits async onMount and registers its resolved cleanup', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const cleaned: Array<string> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', async () => () => {
                cleaned.push('async-cleanup')
            }),
        ])
        const session = await createMount(ctx)(bp)(host)
        createDispose(ctx)(session)
        expect(cleaned).toEqual(['async-cleanup'])
    })

    it('routes duplicate singleton registrations to the loser errors$', async () => {
        const { ctx } = createWorld()
        const bp = blueprintOf({ count: 0 }, [
            provider('app:shared', () => ({ id: 1 }), { lifecycle: 'singleton' }),
        ])
        await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        const loser = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        const codes: Array<string> = []
        loser.errors$.subscribe((error) => {
            codes.push(error.code)
        })
        expect(codes).toEqual(['SINGLETON_CONFLICT'])
    })
})

describe('mount waiting-disconnect and resuscitation', () => {
    it('parks keyed inits in Suspended with deferred onMount, then resuscitates with state intact', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:box', envelope({ count: 41 }))
        storages.set('memory', storage.port)
        const hostA = createFakeHost({ connected: true })
        const ran: Array<string> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', () => {
                ran.push('onMount')
            }),
        ], { storage: 'memory', key: 'app:box' })
        const pending = createMount(ctx)(bp, { token: 'app:box' })(hostA)
        hostA.setConnected(false)
        const parked = await pending
        expect(parked.isSuspended).toBe(true)
        expect(ran).toEqual([])
        storage.port.write('app:box', envelope({ count: 100 }))
        const hostB = createFakeHost({ connected: true })
        const events: Array<string> = []
        parked.lifecycle$.subscribe((event) => {
            events.push(event.type)
        })
        const revived = await createMount(ctx)(bp, { token: 'app:box' })(hostB)
        expect(revived).toBe(parked)
        expect(ran).toEqual(['onMount'])
        expect(events).toEqual(['resuscitated'])
        expect(revived.isSuspended).toBe(false)
        expect(snapshotOf(revived)).toEqual({ count: 41 })
    })

    it('rejects anonymous inits with UNCONNECTED_NODE on waiting-disconnect', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        let resolveGate!: (value: string) => void
        const gate = new Promise<string>((resolve) => {
            resolveGate = resolve
        })
        const bp = blueprintOf({ count: 0 }, [
            provider('app:eager', () => gate, { async: true, eager: true }),
        ])
        const pending = createMount(ctx)(bp)(host)
        host.setConnected(false)
        resolveGate('late')
        const error = await pending.then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('UNCONNECTED_NODE')
    })

    it('suspends keyed sessions on disconnect and disposes them at TTL expiry', async () => {
        const { ctx, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:ttl' })(host)
        const events: Array<string> = []
        session.lifecycle$.subscribe((event) => {
            events.push(event.type)
        })
        host.setConnected(false)
        expect(events).toEqual([])
        scheduler.flushMicrotasks()
        expect(events).toEqual(['suspended'])
        expect(session.isSuspended).toBe(true)
        expect(session.isDisposed).toBe(false)
        scheduler.flushTimeouts()
        expect(events).toEqual(['suspended', 'disposed'])
        expect(session.isDisposed).toBe(true)
    })

    it('disposes anonymous sessions on disconnect after the re-check', async () => {
        const { ctx, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }))(host)
        host.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isDisposed).toBe(true)
    })

    it('treats a reconnected blip as never disconnected', async () => {
        const { ctx, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:blip' })(host)
        host.setConnected(false)
        host.setConnected(true)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(false)
        expect(session.isDisposed).toBe(false)
    })

    it('disposes immediately on disconnect when the TTL is zero', async () => {
        const { ctx, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(
            blueprintOf({ count: 0 }),
            { token: 'app:zero', suspensionTtlMs: 0 },
        )(host)
        host.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isDisposed).toBe(true)
    })

    it('keeps pinned Infinity sessions alive across TTL scheduling', async () => {
        const { ctx, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(
            blueprintOf({ count: 0 }),
            { token: 'app:pinned', suspensionTtlMs: Infinity, retention: 'pinned' },
        )(host)
        host.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(true)
        expect(scheduler.pendingTimeouts()).toBe(0)
        scheduler.flushTimeouts()
        expect(session.isDisposed).toBe(false)
    })

    it('rejects bare Infinity TTL without pinned retention', async () => {
        const { ctx } = createWorld()
        const error = await createMount(ctx)(
            blueprintOf({ count: 0 }),
            { token: 'app:naked', suspensionTtlMs: Infinity },
        )(createFakeHost({ connected: true })).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toMatch(/pinned/)
    })

    it('evicts the oldest suspended entry past the cap', async () => {
        const { ctx, scheduler } = createWorld()
        ;(ctx as unknown as { maxSuspendedPerDocument?: number }).maxSuspendedPerDocument = 2
        const hostOne = createFakeHost({ connected: true })
        const hostTwo = createFakeHost({ connected: true })
        const hostThree = createFakeHost({ connected: true })
        const first = await createMount(ctx)(blueprintOf({ n: 1 }), { token: 'app:one' })(hostOne)
        const second = await createMount(ctx)(blueprintOf({ n: 2 }), { token: 'app:two' })(hostTwo)
        const third = await createMount(ctx)(blueprintOf({ n: 3 }), { token: 'app:three' })(hostThree)
        hostOne.setConnected(false)
        scheduler.flushMicrotasks()
        hostTwo.setConnected(false)
        scheduler.flushMicrotasks()
        expect(first.isSuspended).toBe(true)
        hostThree.setConnected(false)
        scheduler.flushMicrotasks()
        expect(first.isDisposed).toBe(true)
        expect(second.isSuspended).toBe(true)
        expect(third.isSuspended).toBe(true)
    })
})

describe('mount context-request responder', () => {
    it('answers single requests and stops propagation only for singles', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        await createMount(ctx)(blueprintOf({ count: 0 }, [
            provider('app:theme', () => 'dark'),
        ]))(host)
        let answered: unknown
        let stopped = false
        host.dispatch('context-request', {
            detail: { token: 'app:theme', callback: (value: unknown) => { answered = value } },
            stopPropagation: () => { stopped = true },
        })
        expect(answered).toBe('dark')
        expect(stopped).toBe(true)
    })

    it('ignores unknown tokens and malformed details', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        await createMount(ctx)(blueprintOf({ count: 0 }))(host)
        let calls = 0
        host.dispatch('context-request', {
            detail: { token: 'app:missing', callback: () => { calls += 1 } },
            stopPropagation: () => { calls += 100 },
        })
        host.dispatch('context-request', { detail: null })
        host.dispatch('context-request', { detail: { token: 'app:missing' } })
        expect(calls).toBe(0)
    })

    it('walks ancestors nearest-first', async () => {
        const { ctx } = createWorld()
        const grandparent = createFakeHost({ connected: true })
        const parent = createFakeHost({ connected: true, parent: grandparent })
        await createMount(ctx)(blueprintOf({ count: 0 }, [
            provider('app:level', () => 'far'),
        ]))(grandparent)
        await createMount(ctx)(blueprintOf({ count: 0 }, [
            provider('app:level', () => 'near'),
        ]))(parent)
        let answered: unknown
        parent.dispatch('context-request', {
            detail: { token: 'app:level', callback: (value: unknown) => { answered = value } },
        })
        expect(answered).toBe('near')
        let outer: unknown
        grandparent.dispatch('context-request', {
            detail: { token: 'app:level', callback: (value: unknown) => { outer = value } },
        })
        expect(outer).toBe('far')
    })

    it('answers multi requests bottom-up without stopping propagation and ignores subscribe', async () => {
        const { ctx } = createWorld()
        const grandparent = createFakeHost({ connected: true })
        const parent = createFakeHost({ connected: true, parent: grandparent })
        await createMount(ctx)(blueprintOf({ count: 0 }, [
            provider('app:tag', () => 'far-tag', { multi: true }),
        ]))(grandparent)
        await createMount(ctx)(blueprintOf({ count: 0 }, [
            provider('app:tag', () => 'near-tag', { multi: true }),
        ]))(parent)
        let answered: unknown
        let stopped = false
        parent.dispatch('context-request', {
            detail: {
                token: 'app:tag',
                multi: true,
                subscribe: true,
                callback: (value: unknown) => { answered = value },
            },
            stopPropagation: () => { stopped = true },
        })
        expect(answered).toEqual(['near-tag', 'far-tag'])
        expect(stopped).toBe(false)
    })
})

describe('mountSync', () => {
    it('mounts synchronously for sync blueprints', () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = createMountSync(ctx)(blueprintOf({ count: 5 }))(host)
        expect(snapshotOf(session)).toEqual({ count: 5 })
        expect(session.isDisposed).toBe(false)
    })

    it('throws UNCONNECTED_NODE synchronously for disconnected hosts', () => {
        const { ctx } = createWorld()
        expect(() => createMountSync(ctx)(blueprintOf({ count: 0 }))(createFakeHost({ connected: false }))).toThrowError(
            DocumentContextError,
        )
    })

    it('throws ASYNC_SERVICE_NOT_READY for async eager services', () => {
        const { ctx } = createWorld()
        const bp = blueprintOf({ count: 0 }, [
            provider('app:eager', () => Promise.resolve('late'), { async: true, eager: true }),
        ])
        try {
            createMountSync(ctx)(bp)(createFakeHost({ connected: true }))
            expect.unreachable()
        } catch (error) {
            expect(error).toBeInstanceOf(DocumentContextError)
            expect((error as DocumentContextError).code).toBe('ASYNC_SERVICE_NOT_READY')
            expect((error as DocumentContextError).details).toMatchObject({ phase: 'Initializing' })
        }
    })

    it('throws ASYNC_SERVICE_NOT_READY for async storage backends', () => {
        const { ctx, storages } = createWorld()
        const asyncPort: StoragePort = {
            read: async () => ({ ok: true as const, value: null }),
            write: async () => ({ ok: true as const, value: undefined }),
            remove: async () => ({ ok: true as const, value: undefined }),
            observe$: () => new Subject<string | null>().asObservable(),
        }
        storages.set('asyncMemory', asyncPort)
        const bp = blueprintOf({ count: 0 }, [], [], { storage: 'asyncMemory', key: 'app:k' })
        try {
            createMountSync(ctx)(bp)(createFakeHost({ connected: true }))
            expect.unreachable()
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('ASYNC_SERVICE_NOT_READY')
        }
    })

    it('hydrates sync storage inline with hydrateState parity', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:counter', envelope({ count: 11 }))
        storages.set('memory', storage.port)
        const bp = blueprintOf({ count: 0 }, [], [], { storage: 'memory', key: 'app:counter' })
        const session = createMountSync(ctx)(bp)(createFakeHost({ connected: true }))
        expect(snapshotOf(session)).toEqual({ count: 11 })
        const asyncSession = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        expect(snapshotOf(asyncSession)).toEqual(snapshotOf(session))
    })

    it('throws ASYNC_SERVICE_NOT_READY inside an async in-flight window', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        let resolveGate!: (value: string) => void
        const gate = new Promise<string>((resolve) => {
            resolveGate = resolve
        })
        const bp = blueprintOf({ count: 0 }, [
            provider('app:eager', () => gate, { async: true, eager: true }),
        ])
        const pending = createMount(ctx)(bp)(host)
        try {
            createMountSync(ctx)(bp)(host)
            expect.unreachable()
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('ASYNC_SERVICE_NOT_READY')
            expect((error as DocumentContextError).details).toMatchObject({ phase: 'Initializing' })
        }
        resolveGate('done')
        await pending
    })

    it('warns and ignores MountOptions.signal', () => {
        const { ctx } = createWorld()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        try {
            const session = createMountSync(ctx)(
                blueprintOf({ count: 0 }),
                { signal: new AbortController().signal },
            )(createFakeHost({ connected: true }))
            expect(session.isDisposed).toBe(false)
            expect(warn).toHaveBeenCalledOnce()
        } finally {
            warn.mockRestore()
        }
    })

    it('resuscitates suspended sessions synchronously', async () => {
        const { ctx, scheduler } = createWorld()
        const hostA = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 8 }), { token: 'app:sync-revive' })(hostA)
        hostA.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(true)
        const revived = createMountSync(ctx)(blueprintOf({ count: 0 }), { token: 'app:sync-revive' })(
            createFakeHost({ connected: true }),
        )
        expect(revived).toBe(session)
        expect(revived.isSuspended).toBe(false)
        expect(snapshotOf(revived)).toEqual({ count: 8 })
    })

    it('throws ASYNC_SERVICE_NOT_READY when resuscitation owes a deferred onMount', async () => {
        const { ctx } = createWorld()
        const hostA = createFakeHost({ connected: true })
        const bp = blueprintOf({ count: 0 }, [], [hook('mount', () => undefined)])
        const pending = createMount(ctx)(bp, { token: 'app:deferred' })(hostA)
        hostA.setConnected(false)
        await pending
        try {
            createMountSync(ctx)(bp, { token: 'app:deferred' })(createFakeHost({ connected: true }))
            expect.unreachable()
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('ASYNC_SERVICE_NOT_READY')
        }
    })
})

describe('mount error channel edges', () => {
    it('caps pre-subscribe buffering at 32 with a dropped summary', async () => {
        const { ctx } = createWorld()
        const tokens: Array<string> = []
        for (let index = 0; index < 33; index += 1) {
            const token = `app:pre-${index}`
            tokens.push(token)
            await createMount(ctx)(blueprintOf({ count: 0 }, [
                provider(token, () => index, { lifecycle: 'singleton' }),
            ]))(createFakeHost({ connected: true }))
        }
        const loser = await createMount(ctx)(blueprintOf({ count: 0 }, tokens.map((token) => provider(token, () => -1, { lifecycle: 'singleton' }))))(createFakeHost({ connected: true }))
        const seen: Array<DocumentContextError> = []
        let completed = false
        loser.errors$.subscribe({
            next: (error) => {
                seen.push(error)
            },
            complete: () => {
                completed = true
            },
        })
        expect(completed).toBe(false)
        expect(seen).toHaveLength(33)
        expect(seen.every((error) => error.code === 'SINGLETON_CONFLICT')).toBe(true)
        const last = seen[seen.length - 1] as DocumentContextError
        expect((last.details as { readonly dropped?: number }).dropped).toBe(1)
    })

    it('drains the remainder then completes for a late first subscriber after dispose', async () => {
        const { ctx } = createWorld()
        const bp = blueprintOf({ count: 0 }, [
            provider('app:shared', () => ({ id: 1 }), { lifecycle: 'singleton' }),
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

    it('completes later subscribers immediately once the channel is closed', async () => {
        const { ctx } = createWorld()
        const session = await createMount(ctx)(blueprintOf({ count: 0 }))(createFakeHost({ connected: true }))
        createDispose(ctx)(session)
        let firstCompleted = false
        session.errors$.subscribe({ complete: () => { firstCompleted = true } })
        expect(firstCompleted).toBe(true)
        let secondCompleted = false
        let secondValues = 0
        session.errors$.subscribe({
            next: () => {
                secondValues += 1
            },
            complete: () => {
                secondCompleted = true
            },
        })
        expect(secondValues).toBe(0)
        expect(secondCompleted).toBe(true)
    })

    it('forwards live errors to an early subscriber without replaying to late ones', async () => {
        const { ctx } = createWorld()
        const bp = blueprintOf({ count: 0 }, [
            provider('app:shared', () => ({ id: 1 }), { lifecycle: 'singleton' }),
        ])
        await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        const loser = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        const first: Array<string> = []
        loser.errors$.subscribe((error) => {
            first.push(error.code)
        })
        expect(first).toEqual(['SINGLETON_CONFLICT'])
        const second: Array<string> = []
        let secondCompleted = false
        loser.errors$.subscribe({
            next: (error) => {
                second.push(error.code)
            },
            complete: () => {
                secondCompleted = true
            },
        })
        expect(second).toEqual([])
        expect(secondCompleted).toBe(false)
        createDispose(ctx)(loser)
        expect(secondCompleted).toBe(true)
    })
})

describe('mount host normalization edges', () => {
    it('rejects HOST_INVALID for primitive targets', async () => {
        const { ctx } = createWorld()
        const error = await createMount(ctx)(blueprintOf({ count: 0 }))(42 as unknown as FakeHost).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('HOST_INVALID')
    })

    it('surfaces native() failures during key resolution for DOM hosts', async () => {
        const { ctx } = createWorld()
        const throwingHost = {
            ...createFakeHost({ connected: true }),
            native: (): unknown => {
                throw new Error('no-native')
            },
        }
        const error = await createMount(ctx)(blueprintOf({ count: 0 }))(throwingHost).then(
            () => null,
            (reason: unknown) => reason,
        )
        // DOM token resolution requires a readable native; only the ssr
        // nullHost (matched by reference) bypasses the adapter read.
        expect((error as Error).message).toBe('no-native')
    })

    it('falls back to the host key when native() returns a primitive', async () => {
        const { ctx } = createWorld()
        const primitiveHost = {
            ...createFakeHost({ connected: true }),
            native: (): unknown => 42,
        }
        const first = await createMount(ctx)(blueprintOf({ count: 0 }))(primitiveHost)
        const second = await createMount(ctx)(blueprintOf({ count: 0 }))(primitiveHost)
        expect(second).toBe(first)
    })

    it('wraps non-DocumentContextError toHost failures as HOST_INVALID', async () => {
        const { ctx } = createWorld()
        const brokenCtx: ApplicationContext = {
            ...ctx,
            ports: {
                ...ctx.ports,
                host: {
                    ...ctx.ports.host,
                    toHost: (): HostPort => {
                        throw new Error('adapter-boom')
                    },
                },
            },
        }
        const error = await createMount(brokenCtx)(blueprintOf({ count: 0 }))({} as unknown as FakeHost).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('HOST_INVALID')
    })

    it('rejects TOKEN_INVALID for adapter identities violating the namespace', async () => {
        const { ctx, keys } = createWorld()
        const host = createFakeHost({ connected: true })
        keys.set(host.native(), 'no-namespace')
        const error = await createMount(ctx)(blueprintOf({ count: 0 }))(host).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('TOKEN_INVALID')
    })

    it('reads a foreign entry slot as an unknown session on dispose', async () => {
        const { ctx } = createWorld()
        const foreign = {} as unknown as Session
        const slot = Symbol.for('document-context.application.session-entry')
        ;(foreign as unknown as Record<symbol, unknown>)[slot] = 42
        expect(() => createDispose(ctx)(foreign)).not.toThrow()
    })
})

describe('mount keyed identity details', () => {
    it('reads maxSuspendedPerDocument overrides leniently', async () => {
        const { ctx, scheduler } = createWorld()
        ;(ctx as unknown as { maxSuspendedPerDocument?: unknown }).maxSuspendedPerDocument = 'many'
        const bp = blueprintOf({ n: 2 })
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(bp, { token: 'app:lenient' })(host)
        host.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(true)
        // Reconnect alone never unsuspends; an explicit re-mount resuscitates.
        host.setConnected(true)
        const revived = await createMount(ctx)(bp, { token: 'app:lenient' })(host)
        expect(revived).toBe(session)
        expect(session.isSuspended).toBe(false)
        expect(snapshotOf(session)).toEqual({ n: 2 })
        ;(ctx as unknown as { maxSuspendedPerDocument?: unknown }).maxSuspendedPerDocument = Number.NaN
        host.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(true)
    })

    it('floors fractional suspended caps', async () => {
        const { ctx, scheduler } = createWorld()
        ;(ctx as unknown as { maxSuspendedPerDocument?: unknown }).maxSuspendedPerDocument = 2.9
        const hosts = [createFakeHost({ connected: true }), createFakeHost({ connected: true }), createFakeHost({ connected: true })]
        const sessions = [
            await createMount(ctx)(blueprintOf({ n: 1 }), { token: 'app:floor-one' })(hosts[0] as FakeHost),
            await createMount(ctx)(blueprintOf({ n: 2 }), { token: 'app:floor-two' })(hosts[1] as FakeHost),
            await createMount(ctx)(blueprintOf({ n: 3 }), { token: 'app:floor-three' })(hosts[2] as FakeHost),
        ]
        for (const host of hosts) {
            (host as FakeHost).setConnected(false)
            scheduler.flushMicrotasks()
        }
        const disposed = sessions.filter((session) => session.isDisposed)
        expect(disposed).toHaveLength(1)
        expect(disposed[0]).toBe(sessions[0])
    })
})

describe('mount async resuscitation', () => {
    it('revives a suspended session on a new host with hooks, responder, and lifecycle', async () => {
        const { ctx, scheduler } = createWorld()
        const hostA = createFakeHost({ connected: true })
        const events: Array<string> = []
        const bp = blueprintOf({ count: 3 }, [
            provider('app:theme', () => 'dark'),
        ], [
            hook('suspend', () => {
                events.push('suspend-hook')
            }),
            hook('resuscitate', () => {
                events.push('resuscitate-hook')
            }),
        ])
        const session = await createMount(ctx)(bp, { token: 'app:revive' })(hostA)
        const lifecycle: Array<string> = []
        session.lifecycle$.subscribe((event) => {
            lifecycle.push(event.type)
        })
        // The host facade forwards host lifecycle events behind the stable facade.
        const forwarded: Array<string> = []
        session.host.lifecycle$.subscribe((event) => {
            forwarded.push(event.type)
        })
        hostA.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(true)
        expect(events).toEqual(['suspend-hook'])
        const hostB = createFakeHost({ connected: true })
        const revived = await createMount(ctx)(bp, { token: 'app:revive' })(hostB)
        expect(revived).toBe(session)
        expect(session.isSuspended).toBe(false)
        expect(events).toEqual(['suspend-hook', 'resuscitate-hook'])
        expect(lifecycle).toEqual(['suspended', 'resuscitated'])
        expect(snapshotOf(session)).toEqual({ count: 3 })
        // The repointed facade answers scope requests on the new host.
        let answered: unknown
        hostB.dispatch('context-request', {
            detail: { token: 'app:theme', callback: (value: unknown) => { answered = value } },
        })
        expect(answered).toBe('dark')
        // Facade getters track the repointed host.
        expect(session.host.isConnected).toBe(true)
        expect(session.isConnected).toBe(true)
        hostB.setConnected(false)
        expect(forwarded[forwarded.length - 1]).toBe('disconnect')
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(true)
    })

    it('revives a disconnect-pending session before the re-check fires', async () => {
        const { ctx } = createWorld()
        const hostA = createFakeHost({ connected: true })
        const bp = blueprintOf({ count: 8 })
        const session = await createMount(ctx)(bp, { token: 'app:pending-revive' })(hostA)
        hostA.setConnected(false)
        const hostB = createFakeHost({ connected: true })
        const revived = await createMount(ctx)(bp, { token: 'app:pending-revive' })(hostB)
        expect(revived).toBe(session)
        expect(session.isSuspended).toBe(false)
        expect(session.isDisposed).toBe(false)
        expect(snapshotOf(session)).toEqual({ count: 8 })
    })

    it('routes suspend-hook throws into HOOK_ERROR without breaking the park', async () => {
        const { ctx, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        const bp = blueprintOf({ count: 0 }, [], [
            hook('suspend', () => {
                throw new Error('suspend-broken')
            }),
        ])
        const session = await createMount(ctx)(bp, { token: 'app:suspend-broken' })(host)
        const codes: Array<string> = []
        session.errors$.subscribe((error) => {
            codes.push(error.code)
        })
        host.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(true)
        expect(codes).toEqual(['HOOK_ERROR'])
    })

    it('routes resuscitate-hook throws into HOOK_ERROR while completing the revival', async () => {
        const { ctx, scheduler } = createWorld()
        const hostA = createFakeHost({ connected: true })
        const bp = blueprintOf({ count: 0 }, [], [
            hook('resuscitate', () => {
                throw new Error('resuscitate-broken')
            }),
        ])
        const session = await createMount(ctx)(bp, { token: 'app:resuscitate-broken' })(hostA)
        const codes: Array<string> = []
        session.errors$.subscribe((error) => {
            codes.push(error.code)
        })
        hostA.setConnected(false)
        scheduler.flushMicrotasks()
        const revived = await createMount(ctx)(bp, { token: 'app:resuscitate-broken' })(createFakeHost({ connected: true }))
        expect(revived).toBe(session)
        expect(session.isSuspended).toBe(false)
        expect(codes).toEqual(['HOOK_ERROR'])
    })

    it('treats mounted-but-reconnected-then-dropped hosts as still suspended, not double-parked', async () => {
        const { ctx, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        const events: Array<string> = []
        const session = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:flap' })(host)
        session.lifecycle$.subscribe((event) => {
            events.push(event.type)
        })
        host.setConnected(false)
        scheduler.flushMicrotasks()
        expect(events).toEqual(['suspended'])
        host.setConnected(true)
        host.setConnected(false)
        scheduler.flushMicrotasks()
        expect(events).toEqual(['suspended'])
        expect(session.isSuspended).toBe(true)
    })

    it('ignores connect and adopt events on live sessions', async () => {
        const { ctx, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:calm' })(host)
        host.adoptTo({ document: 'other' })
        host.setConnected(true)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(false)
        expect(session.isDisposed).toBe(false)
    })

    it('drops a re-check that lands after disposal', async () => {
        const { ctx, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        const events: Array<string> = []
        const session = await createMount(ctx)(blueprintOf({ count: 0 }))(host)
        session.lifecycle$.subscribe((event) => {
            events.push(event.type)
        })
        host.setConnected(false)
        createDispose(ctx)(session)
        scheduler.flushMicrotasks()
        expect(events).toEqual(['disposed'])
        expect(session.isDisposed).toBe(true)
    })
})

describe('mount scope responder edges', () => {
    it('answers lazy singletons through the ancestor walk with first-published-wins identity', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        let calls = 0
        await createMount(ctx)(blueprintOf({ count: 0 }, [
            provider('app:lazy-single', () => {
                calls += 1
                return { n: calls }
            }, { lifecycle: 'singleton' }),
        ]))(host)
        // Lazy singleton factories run once: the first published value is
        // cached application-wide (02 §2.4 first-registration wins) instead
        // of re-running per dispatch.
        const answers: Array<unknown> = []
        for (let round = 0; round < 2; round += 1) {
            host.dispatch('context-request', {
                detail: { token: 'app:lazy-single', callback: (value: unknown) => { answers.push(value) } },
            })
        }
        expect(calls).toBe(1)
        expect(answers).toHaveLength(2)
        expect(answers[0]).toBe(answers[1])
    })

    it('skips async singleton registrations one-shot without answering', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        await createMount(ctx)(blueprintOf({ count: 0 }, [
            provider('app:async-one', () => Promise.resolve('late'), { async: true }),
        ]))(host)
        let calls = 0
        host.dispatch('context-request', {
            detail: { token: 'app:async-one', callback: () => { calls += 1 } },
        })
        expect(calls).toBe(0)
    })

    it('skips throwing factories one-shot without answering', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        await createMount(ctx)(blueprintOf({ count: 0 }, [
            provider('app:throws', () => {
                throw new Error('factory-broken')
            }),
        ]))(host)
        let calls = 0
        host.dispatch('context-request', {
            detail: { token: 'app:throws', callback: () => { calls += 1 } },
        })
        expect(calls).toBe(0)
    })

    it('skips async multi registrations one-shot', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        await createMount(ctx)(blueprintOf({ count: 0 }, [
            provider('app:async-tag', () => Promise.resolve('late'), { async: true, multi: true }),
        ]))(host)
        let calls = 0
        host.dispatch('context-request', {
            detail: { token: 'app:async-tag', multi: true, callback: () => { calls += 1 } },
        })
        expect(calls).toBe(0)
    })

    it('skips throwing multi factories one-shot', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        await createMount(ctx)(blueprintOf({ count: 0 }, [
            provider('app:bad-tag', () => {
                throw new Error('multi-broken')
            }, { multi: true }),
        ]))(host)
        let calls = 0
        host.dispatch('context-request', {
            detail: { token: 'app:bad-tag', multi: true, callback: () => { calls += 1 } },
        })
        expect(calls).toBe(0)
    })

    it('answers empty multi snapshots with silence and keeps singles propagation intact', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        await createMount(ctx)(blueprintOf({ count: 0 }))(host)
        let multiCalls = 0
        host.dispatch('context-request', {
            detail: { token: 'app:tag', multi: true, callback: () => { multiCalls += 1 } },
        })
        expect(multiCalls).toBe(0)
        host.dispatch('context-request', 42)
        host.dispatch('context-request', { detail: 42 })
    })

    it('reads scoped instances from the per-session cache on repeat requests', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        let calls = 0
        await createMount(ctx)(blueprintOf({ count: 0 }, [
            provider('app:cached', () => {
                calls += 1
                return { n: calls }
            }),
        ]))(host)
        const answers: Array<unknown> = []
        for (let round = 0; round < 2; round += 1) {
            host.dispatch('context-request', {
                detail: { token: 'app:cached', callback: (value: unknown) => { answers.push(value) } },
            })
        }
        expect(calls).toBe(1)
        expect(answers[0]).toBe(answers[1])
    })

    it('sees nothing on warming sessions and nothing on suspended records', async () => {
        const { ctx, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }, [
            provider('app:theme', () => 'dark'),
        ]), { token: 'app:nap' })(host)
        host.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(true)
        let calls = 0
        host.dispatch('context-request', {
            detail: { token: 'app:theme', callback: () => { calls += 1 } },
        })
        expect(calls).toBe(0)
    })

    it('exposes host facade getters and the on() bridge', async () => {
        const { ctx } = createWorld()
        const parent = createFakeHost({ connected: true })
        const child = createFakeHost({ connected: true, parent })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:facade' })(child)
        expect(session.host.token).toBeNull()
        expect(session.host.isConnected).toBe(true)
        expect(session.host.parent).toBe(parent)
        expect(session.host.native()).toBe(child.native())
        let heard: Array<unknown> = []
        const off = session.host.on('ping', (event: unknown) => {
            heard.push(event)
        })
        child.dispatch('ping', { n: 1 })
        expect(heard).toEqual([{ n: 1 }])
        off()
        child.dispatch('ping', { n: 2 })
        expect(heard).toEqual([{ n: 1 }])
        const lifecycles: Array<unknown> = []
        const sub = session.host.lifecycle$.subscribe((event: unknown) => {
            lifecycles.push(event)
        })
        child.setConnected(false)
        expect(lifecycles).toEqual([{ type: 'disconnect' }])
        sub.unsubscribe()
    })
})

describe('mount eager and singleton warming', () => {
    it('lets a losing eager-singleton claimant mount and share the winner instance', async () => {
        const { ctx } = createWorld()
        let calls = 0
        const bp = blueprintOf({ count: 0 }, [
            provider('app:contended', () => {
                calls += 1
                return { id: 'mine' }
            }, { lifecycle: 'singleton', eager: true }),
        ])
        const winnerHost = createFakeHost({ connected: true })
        const winner = await createMount(ctx)(bp)(winnerHost)
        expect(winner.isDisposed).toBe(false)
        expect(calls).toBe(1)
        // Duplicate singleton declarations are ignored per 02 §2.4
        // (first registration wins): the loser mounts successfully, reports
        // SINGLETON_CONFLICT, and never runs the factory. Warming the loser's
        // copy through the registry sandwich used to trip the sync re-entry
        // guard with a misleading CIRCULAR_DEPENDENCY.
        const loserHost = createFakeHost({ connected: true })
        const loser = await createMount(ctx)(bp)(loserHost)
        expect(loser.isDisposed).toBe(false)
        expect(calls).toBe(1)
        const codes: Array<string> = []
        loser.errors$.subscribe((error) => {
            codes.push(error.code)
        })
        expect(codes).toEqual(['SINGLETON_CONFLICT'])
        const answers: Array<unknown> = []
        loserHost.dispatch('context-request', {
            detail: { token: 'app:contended', callback: (value: unknown) => { answers.push(value) } },
        })
        const winnerAnswers: Array<unknown> = []
        winnerHost.dispatch('context-request', {
            detail: { token: 'app:contended', callback: (value: unknown) => { winnerAnswers.push(value) } },
        })
        expect(answers).toHaveLength(1)
        expect(answers[0]).toBe(winnerAnswers[0])
    })

    it('lets a losing eager-singleton claimant mountSync and share the winner instance', async () => {
        const { ctx } = createWorld()
        let calls = 0
        const bp = blueprintOf({ count: 0 }, [
            provider('app:sync-contended', () => {
                calls += 1
                return { id: 'mine' }
            }, { lifecycle: 'singleton', eager: true }),
        ])
        const winner = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        expect(winner.isDisposed).toBe(false)
        const loser = createMountSync(ctx)(bp)(createFakeHost({ connected: true }))
        expect(loser.isDisposed).toBe(false)
        expect(calls).toBe(1)
        const codes: Array<string> = []
        loser.errors$.subscribe((error) => {
            codes.push(error.code)
        })
        expect(codes).toEqual(['SINGLETON_CONFLICT'])
    })

    it('releases singleton markers when an eager singleton rejects, healing the retry', async () => {
        const { ctx } = createWorld()
        const boom = new Error('singleton-eager-boom')
        let calls = 0
        const bp = blueprintOf({ count: 0 }, [
            {
                token: 'app:flaky-single',
                factory: () => {
                    calls += 1
                    return calls === 1 ? Promise.reject(boom) : Promise.resolve('healed')
                },
                lifecycle: 'singleton',
                async: true,
                multi: false,
                eager: true,
            } as ServiceRegistration,
        ])
        const first = await createMount(ctx)(bp)(createFakeHost({ connected: true })).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(first).toBe(boom)
        const second = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        expect(second.isDisposed).toBe(false)
        expect(calls).toBe(2)
    })

    it('fails the mount on async onMount rejection after running earlier cleanups', async () => {
        const { ctx } = createWorld()
        const cleaned: Array<number> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', () => () => {
                cleaned.push(1)
            }),
            hook('mount', () => Promise.reject(new Error('async-mount-broken'))),
        ])
        const error = await createMount(ctx)(bp)(createFakeHost({ connected: true })).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('HOOK_ERROR')
        expect(cleaned).toEqual([1])
    })

    it('runs async onMount cleanups through disposal', async () => {
        const { ctx } = createWorld()
        const cleaned: Array<string> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', async () => {
                await Promise.resolve()
                return () => {
                    cleaned.push('async-cleanup')
                }
            }),
        ])
        const session = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        createDispose(ctx)(session)
        expect(cleaned).toEqual(['async-cleanup'])
    })

    it('disposes parked mounts with null responder wiring and an armed TTL', async () => {
        const { ctx, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        const bp = blueprintOf({ count: 0 }, [], [
            hook('dispose', () => undefined),
        ])
        const pending = createMount(ctx)(bp, { token: 'app:parked-dispose' })(host)
        host.setConnected(false)
        const parked = await pending
        expect(parked.isSuspended).toBe(true)
        expect(scheduler.pendingTimeouts()).toBe(1)
        // The suspension fired before the facade existed, so only the
        // terminal event is observable here.
        const events: Array<string> = []
        parked.lifecycle$.subscribe((event) => {
            events.push(event.type)
        })
        createDispose(ctx)(parked)
        expect(parked.isDisposed).toBe(true)
        expect(events).toEqual(['disposed'])
        expect(scheduler.pendingTimeouts()).toBe(0)
    })

    it('succeeds with a mount signal that never aborts', async () => {
        const { ctx } = createWorld()
        const controller = new AbortController()
        const session = await createMount(ctx)(
            blueprintOf({ count: 0 }),
            { signal: controller.signal },
        )(createFakeHost({ connected: true }))
        expect(session.isDisposed).toBe(false)
    })

    it('rejects anonymous mounts that disconnect during eager warming', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const bp = blueprintOf({ count: 0 }, [
            provider('app:dropper', (session: unknown) => {
                void session
                host.setConnected(false)
                return 'dropped'
            }, { eager: true }),
        ])
        const error = await createMount(ctx)(bp)(host).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('UNCONNECTED_NODE')
    })

    it('parks keyed mounts that disconnect during eager warming', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const bp = blueprintOf({ count: 7 }, [
            provider('app:dropper', (session: unknown) => {
                void session
                host.setConnected(false)
                return 'dropped'
            }, { eager: true }),
        ])
        const parked = await createMount(ctx)(bp, { token: 'app:warm-park' })(host)
        expect(parked.isSuspended).toBe(true)
        expect(snapshotOf(parked)).toEqual({ count: 7 })
        const revived = await createMount(ctx)(bp, { token: 'app:warm-park' })(createFakeHost({ connected: true }))
        expect(revived).toBe(parked)
        expect(revived.isSuspended).toBe(false)
    })
})

describe('mount in-flight failure retries', () => {
    it('retries a same-host mount after its peer fails', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const boom = new Error('first-boom')
        let calls = 0
        const bp = blueprintOf({ count: 0 }, [
            {
                token: 'app:flaky',
                factory: () => {
                    calls += 1
                    return calls === 1 ? Promise.reject(boom) : Promise.resolve('recovered')
                },
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            } as ServiceRegistration,
        ])
        const mount = createMount(ctx)(bp)
        const pendingFirst = mount(host)
        const pendingSecond = mount(host)
        const first = await pendingFirst.then(
            () => null,
            (reason: unknown) => reason,
        )
        const second = await pendingSecond
        expect(first).toBe(boom)
        expect(second.isDisposed).toBe(false)
        expect(calls).toBe(2)
    })

    it('retries a same-token mount on another host after its peer fails', async () => {
        const { ctx } = createWorld()
        const boom = new Error('token-boom')
        let calls = 0
        const bp = blueprintOf({ count: 0 }, [
            {
                token: 'app:flaky-token',
                factory: () => {
                    calls += 1
                    return calls === 1 ? Promise.reject(boom) : Promise.resolve('recovered')
                },
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            } as ServiceRegistration,
        ])
        const hostA = createFakeHost({ connected: true })
        const hostB = createFakeHost({ connected: true })
        const pendingA = createMount(ctx)(bp, { token: 'app:retry-token' })(hostA)
        const pendingB = createMount(ctx)(bp, { token: 'app:retry-token' })(hostB)
        const first = await pendingA.then(
            () => null,
            (reason: unknown) => reason,
        )
        const second = await pendingB
        expect(first).toBe(boom)
        expect(second.token).toBe('app:retry-token')
        expect(calls).toBe(2)
    })
})

describe('mount hydration sources', () => {
    it('hydrates from a directly provided storage port object', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:direct', envelope({ count: 55 }))
        storages.set('memory', storage.port)
        const direct = storages.get('memory') as StoragePort
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(
            blueprintOf({ count: 0 }, [], [], { storage: direct, key: 'app:direct' }),
        )(host)
        expect(snapshotOf(session)).toEqual({ count: 55 })
    })

    it('degrades non-object payloads to the seed without failing', async () => {
        const { ctx } = createWorld()
        const withSsr: ApplicationContext = {
            ...ctx,
            ports: {
                ...ctx.ports,
                ssr: {
                    nullHost: createFakeHost({ connected: true }),
                    payloadResolver: () => 42,
                    serialize: () => () => '{}',
                },
            },
        }
        const session = await createMount(withSsr)(blueprintOf({ count: 3 }))(createFakeHost({ connected: true }))
        expect(snapshotOf(session)).toEqual({ count: 3 })
        const withArray: ApplicationContext = {
            ...ctx,
            ports: {
                ...ctx.ports,
                ssr: {
                    nullHost: createFakeHost({ connected: true }),
                    payloadResolver: () => [1, 2],
                    serialize: () => () => '{}',
                },
            },
        }
        const second = await createMount(withArray)(blueprintOf({ count: 4 }))(createFakeHost({ connected: true }))
        expect(snapshotOf(second)).toEqual({ count: 4 })
    })

    it('ignores the payload resolver under ssrPayload off', async () => {
        const { ctx } = createWorld()
        const withSsr: ApplicationContext = {
            ...ctx,
            ports: {
                ...ctx.ports,
                ssr: {
                    nullHost: createFakeHost({ connected: true }),
                    payloadResolver: () => ({ count: 99 }),
                    serialize: () => () => '{}',
                },
            },
        }
        const session = await createMount(withSsr)(
            blueprintOf({ count: 1 }),
            { ssrPayload: 'off' },
        )(createFakeHost({ connected: true }))
        expect(snapshotOf(session)).toEqual({ count: 1 })
    })

    it('migrates older stored versions through the migrate hook', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:migrate', JSON.stringify({ v: 0, d: { legacy: 'x' } }))
        storages.set('memory', storage.port)
        const bp = blueprintOf({ count: 0 }, [], [], {
            storage: 'memory',
            key: 'app:migrate',
            version: 1,
            migrate: (persisted: unknown) => ({ count: (persisted as { readonly legacy?: string }).legacy === 'x' ? 10 : 0 }),
        })
        const session = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        expect(snapshotOf(session)).toEqual({ count: 10 })
    })

    it('buffers INVALID_STORAGE_DATA when migration is missing or fails', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:old', JSON.stringify({ v: 0, d: { count: 1 } }))
        storages.set('memory', storage.port)
        const withoutMigrate = blueprintOf({ count: 5 }, [], [], {
            storage: 'memory',
            key: 'app:old',
            version: 2,
        })
        const first = await createMount(ctx)(withoutMigrate)(createFakeHost({ connected: true }))
        expect(snapshotOf(first)).toEqual({ count: 5 })
        const firstCodes: Array<string> = []
        first.errors$.subscribe((error) => {
            firstCodes.push(error.code)
        })
        expect(firstCodes).toEqual(['INVALID_STORAGE_DATA'])
        const throwingMigrate = blueprintOf({ count: 6 }, [], [], {
            storage: 'memory',
            key: 'app:old',
            version: 2,
            migrate: () => {
                throw new Error('migrate-broken')
            },
        })
        const second = await createMount(ctx)(throwingMigrate)(createFakeHost({ connected: true }))
        expect(snapshotOf(second)).toEqual({ count: 6 })
        const secondCodes: Array<string> = []
        second.errors$.subscribe((error) => {
            secondCodes.push(error.code)
        })
        expect(secondCodes).toEqual(['INVALID_STORAGE_DATA'])
        const shapingMigrate = blueprintOf({ count: 7 }, [], [], {
            storage: 'memory',
            key: 'app:old',
            version: 2,
            migrate: () => 42 as unknown as Record<string, unknown>,
        })
        const third = await createMount(ctx)(shapingMigrate)(createFakeHost({ connected: true }))
        expect(snapshotOf(third)).toEqual({ count: 7 })
    })

    it('blocks newer stored versions and keeps the seed', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:newer', JSON.stringify({ v: 3, d: { count: 100 } }))
        storages.set('memory', storage.port)
        const bp = blueprintOf({ count: 8 }, [], [], {
            storage: 'memory',
            key: 'app:newer',
            version: 1,
        })
        const session = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        expect(snapshotOf(session)).toEqual({ count: 8 })
        const codes: Array<string> = []
        session.errors$.subscribe((error) => {
            codes.push(error.code)
        })
        expect(codes).toEqual(['INVALID_STORAGE_DATA'])
    })

    it('buffers INVALID_STORAGE_DATA for shapeless stored payloads', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:shapeless', JSON.stringify({ hello: 'world' }))
        storages.set('memory', storage.port)
        const bp = blueprintOf({ count: 9 }, [], [], { storage: 'memory', key: 'app:shapeless' })
        const session = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        expect(snapshotOf(session)).toEqual({ count: 9 })
        const codes: Array<string> = []
        session.errors$.subscribe((error) => {
            codes.push(error.code)
        })
        expect(codes).toEqual(['INVALID_STORAGE_DATA'])
        storage.port.write('app:shapeless', JSON.stringify({ v: 0, d: 42 }))
        const second = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        expect(snapshotOf(second)).toEqual({ count: 9 })
    })

    it('prefers the payload under payloadFirst and the seed under blueprintFirst', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:race', envelope({ count: 20 }))
        storages.set('memory', storage.port)
        const withSsr = (payload: Record<string, unknown>): ApplicationContext => ({
            ...ctx,
            ports: {
                ...ctx.ports,
                ssr: {
                    nullHost: createFakeHost({ connected: true }),
                    payloadResolver: () => payload,
                    serialize: () => () => '{}',
                },
            },
        })
        const payloadFirst = blueprintOf({ count: 0 }, [], [], {
            storage: 'memory',
            key: 'app:race',
            hydration: 'payloadFirst',
        })
        const first = await createMount(withSsr({ count: 30 }))(payloadFirst)(createFakeHost({ connected: true }))
        expect(snapshotOf(first)).toEqual({ count: 30 })
        const blueprintFirst = blueprintOf({ count: 1 }, [], [], {
            storage: 'memory',
            key: 'app:race',
            hydration: 'blueprintFirst',
        })
        const second = await createMount(withSsr({ count: 30 }))(blueprintFirst)(createFakeHost({ connected: true }))
        expect(snapshotOf(second)).toEqual({ count: 1 })
        const storageFirst = blueprintOf({ count: 0 }, [], [], {
            storage: 'memory',
            key: 'app:race',
            hydration: 'storageFirst',
        })
        const third = await createMount(withSsr({ count: 30 }))(storageFirst)(createFakeHost({ connected: true }))
        expect(snapshotOf(third)).toEqual({ count: 20 })
        const merged = blueprintOf({ count: 0 }, [], [], {
            storage: 'memory',
            key: 'app:race',
            hydration: 'merge',
        })
        const fourth = await createMount(withSsr({ count: 30 }))(merged)(createFakeHost({ connected: true }))
        expect(snapshotOf(fourth)).toEqual({ count: 30 })
    })
})

describe('mountSync hydration matrix', () => {
    const withSsr = (ctx: ApplicationContext, payload: unknown): ApplicationContext => ({
        ...ctx,
        ports: {
            ...ctx.ports,
            ssr: {
                nullHost: createFakeHost({ connected: true }),
                payloadResolver: () => payload as Record<string, unknown> | null,
                serialize: () => () => '{}',
            },
        },
    })

    it('hydrates from a directly provided storage port object', () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:direct-sync', envelope({ count: 66 }))
        storages.set('memory', storage.port)
        const direct = storages.get('memory') as StoragePort
        const session = createMountSync(ctx)(
            blueprintOf({ count: 0 }, [], [], { storage: direct, key: 'app:direct-sync' }),
        )(createFakeHost({ connected: true }))
        expect(snapshotOf(session)).toEqual({ count: 66 })
    })

    it('throws UNKNOWN_SERVICE for unregistered storage keywords', () => {
        const { ctx } = createWorld()
        try {
            createMountSync(ctx)(
                blueprintOf({ count: 0 }, [], [], { storage: 'missingBackend' as unknown as 'memory', key: 'app:k' }),
            )(createFakeHost({ connected: true }))
            expect.unreachable()
        } catch (error) {
            expect(error).toBeInstanceOf(DocumentContextError)
            expect((error as DocumentContextError).code).toBe('UNKNOWN_SERVICE')
        }
    })

    it('throws ASYNC_SERVICE_NOT_READY for async payload resolvers', () => {
        const { ctx } = createWorld()
        const asyncSsr: ApplicationContext = {
            ...ctx,
            ports: {
                ...ctx.ports,
                ssr: {
                    nullHost: createFakeHost({ connected: true }),
                    payloadResolver: () => Promise.resolve({ count: 1 }) as unknown as Record<string, unknown>,
                    serialize: () => () => '{}',
                },
            },
        }
        try {
            createMountSync(asyncSsr)(blueprintOf({ count: 0 }))(createFakeHost({ connected: true }))
            expect.unreachable()
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('ASYNC_SERVICE_NOT_READY')
        }
    })

    it('applies every hydration strategy over storage plus payload', () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:matrix', envelope({ count: 20 }))
        storages.set('memory', storage.port)
        const states: Array<number> = []
        for (const hydration of ['storageFirst', 'payloadFirst', 'blueprintFirst', 'merge'] as const) {
            const session = createMountSync(withSsr(ctx, { count: 30 }))(
                blueprintOf({ count: 1 }, [], [], { storage: 'memory', key: 'app:matrix', hydration }),
            )(createFakeHost({ connected: true }))
            states.push(snapshotOf(session).count)
        }
        expect(states).toEqual([20, 30, 1, 30])
    })

    it('keeps payload-only hydration with and without blueprint precedence', () => {
        const { ctx } = createWorld()
        const payloadOnly = createMountSync(withSsr(ctx, { count: 12 }))(
            blueprintOf({ count: 0 }),
        )(createFakeHost({ connected: true }))
        expect(snapshotOf(payloadOnly)).toEqual({ count: 12 })
        const seedWins = createMountSync(withSsr(ctx, { count: 12 }))(
            blueprintOf({ count: 2 }, [], [], { storage: null, key: '', hydration: 'blueprintFirst' } as unknown as ContextBlueprint<{ count: number }>['storage']),
        )(createFakeHost({ connected: true }))
        expect(snapshotOf(seedWins)).toEqual({ count: 2 })
    })

    it('migrates older stored versions through the migrate hook', () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:migrate-sync', JSON.stringify({ v: 0, d: { legacy: 'x' } }))
        storages.set('memory', storage.port)
        const session = createMountSync(ctx)(blueprintOf({ count: 0 }, [], [], {
            storage: 'memory',
            key: 'app:migrate-sync',
            version: 1,
            migrate: (persisted: unknown) => ({ count: (persisted as { readonly legacy?: string }).legacy === 'x' ? 10 : 0 }),
        }))(createFakeHost({ connected: true }))
        expect(snapshotOf(session)).toEqual({ count: 10 })
    })

    it('buffers INVALID_STORAGE_DATA for missing, failing, and shaping migrations', () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:old-sync', JSON.stringify({ v: 0, d: { count: 1 } }))
        storages.set('memory', storage.port)
        const check = (
            bp: ContextBlueprint<{ count: number }>,
            seed: number,
        ): void => {
            const session = createMountSync(ctx)(bp)(createFakeHost({ connected: true }))
            expect(snapshotOf(session)).toEqual({ count: seed })
            const codes: Array<string> = []
            session.errors$.subscribe((error) => {
                codes.push(error.code)
            })
            expect(codes).toEqual(['INVALID_STORAGE_DATA'])
        }
        check(blueprintOf({ count: 5 }, [], [], { storage: 'memory', key: 'app:old-sync', version: 2 }), 5)
        check(blueprintOf({ count: 6 }, [], [], {
            storage: 'memory',
            key: 'app:old-sync',
            version: 2,
            migrate: () => {
                throw new Error('migrate-broken')
            },
        }), 6)
        check(blueprintOf({ count: 7 }, [], [], {
            storage: 'memory',
            key: 'app:old-sync',
            version: 2,
            migrate: () => 42 as unknown as Record<string, unknown>,
        }), 7)
    })

    it('blocks newer stored versions and falls back for shapeless payloads', () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:newer-sync', JSON.stringify({ v: 3, d: { count: 100 } }))
        storage.port.write('app:shapeless-sync', JSON.stringify({ hello: 'world' }))
        storage.port.write('app:scalar-sync', JSON.stringify({ v: 0, d: 42 }))
        storages.set('memory', storage.port)
        const check = (key: string, seed: number): void => {
            const session = createMountSync(ctx)(
                blueprintOf({ count: seed }, [], [], { storage: 'memory', key, version: 1 }),
            )(createFakeHost({ connected: true }))
            expect(snapshotOf(session)).toEqual({ count: seed })
            const codes: Array<string> = []
            session.errors$.subscribe((error) => {
                codes.push(error.code)
            })
            expect(codes).toEqual(['INVALID_STORAGE_DATA'])
        }
        check('app:newer-sync', 8)
        check('app:shapeless-sync', 9)
        check('app:scalar-sync', 10)
    })

    it('falls back to the seed or reset seed on unreadable storage', () => {
        const { ctx } = createWorld()
        const failing: StoragePort = {
            read: () => ({ ok: false as const, error: { kind: 'unavailable' as const } }),
            write: () => ({ ok: true as const, value: undefined }),
            remove: () => ({ ok: true as const, value: undefined }),
            observe$: () => new Subject<string | null>().asObservable(),
        }
        const session = createMountSync(ctx)(
            blueprintOf({ count: 11 }, [], [], { storage: failing, key: 'app:unreadable' }),
        )(createFakeHost({ connected: true }))
        expect(snapshotOf(session)).toEqual({ count: 11 })
        const host = createFakeHost({ connected: true })
        const first = createMountSync(ctx)(
            blueprintOf({ count: 11 }, [], [], { storage: failing, key: 'app:unreadable' }),
            { token: 'app:reset-me' },
        )(host)
        expect(snapshotOf(first)).toEqual({ count: 11 })
        const second = createMountSync(ctx)(
            blueprintOf({ count: 0 }, [], [], { storage: failing, key: 'app:unreadable' }),
            { token: 'app:reset-seed', onConflict: 'reset' },
        )(host)
        expect(first.isDisposed).toBe(true)
        expect(snapshotOf(second)).toEqual({ count: 11 })
    })

    it('throws for sync eager factories and for promise-returning sync providers', () => {
        const { ctx } = createWorld()
        const throwing = blueprintOf({ count: 0 }, [
            {
                token: 'app:sync-boom',
                factory: () => {
                    throw new Error('sync-eager-broken')
                },
                lifecycle: 'scoped',
                async: false,
                multi: false,
                eager: true,
            },
        ])
        try {
            createMountSync(ctx)(throwing)(createFakeHost({ connected: true }))
            expect.unreachable()
        } catch (error) {
            expect((error as Error).message).toBe('sync-eager-broken')
        }
        const promising = blueprintOf({ count: 0 }, [
            {
                token: 'app:promise-sync',
                factory: () => Promise.resolve('late'),
                lifecycle: 'scoped',
                async: false,
                multi: false,
                eager: true,
            },
        ])
        try {
            createMountSync(ctx)(promising)(createFakeHost({ connected: true }))
            expect.unreachable()
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('ASYNC_SERVICE_NOT_READY')
        }
        expect(ctx.sessions.get({} as object)).toBeUndefined()
    })
})

describe('mountSync keyed conflicts', () => {
    it('evicts and resets same-host identities synchronously', () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const first = createMountSync(ctx)(blueprintOf({ count: 4 }), { token: 'app:sync-first' })(host)
        const second = createMountSync(ctx)(
            blueprintOf({ count: 0 }),
            { token: 'app:sync-second', onConflict: 'evict' },
        )(host)
        expect(first.isDisposed).toBe(true)
        expect(second.token).toBe('app:sync-second')
        expect(snapshotOf(second)).toEqual({ count: 0 })
        const third = createMountSync(ctx)(
            blueprintOf({ count: 0 }),
            { token: 'app:sync-third', onConflict: 'reset' },
        )(host)
        expect(second.isDisposed).toBe(true)
        expect(snapshotOf(third)).toEqual({ count: 0 })
    })

    it('throws KEYED_SESSION_CONFLICT for dual-active keyed sessions', async () => {
        const { ctx } = createWorld()
        const bp = blueprintOf({ count: 0 })
        createMountSync(ctx)(bp, { token: 'app:sync-live' })(createFakeHost({ connected: true }))
        // The domain kernel settles `initializing` on microtasks; let it land first.
        await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 0)
        })
        try {
            createMountSync(ctx)(bp, { token: 'app:sync-live' })(createFakeHost({ connected: true }))
            expect.unreachable()
        } catch (error) {
            expect(error).toBeInstanceOf(DocumentContextError)
            expect((error as DocumentContextError).code).toBe('KEYED_SESSION_CONFLICT')
        }
    })

    it('takes over keyed identities left by foreign facades', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const foreign = { kind: 'foreign-session' } as unknown as Session
        ctx.keyed.set('app:foreign-key', foreign)
        const session = createMountSync(ctx)(blueprintOf({ count: 3 }), { token: 'app:foreign-key' })(host)
        expect(session.token).toBe('app:foreign-key')
        expect(snapshotOf(session)).toEqual({ count: 3 })
        expect(ctx.keyed.get('app:foreign-key')).toBe(session as Session)
        const asyncSession = await createMount(ctx)(blueprintOf({ count: 5 }), { token: 'app:foreign-async' })(createFakeHost({ connected: true }))
        ctx.keyed.set('app:foreign-async-takeover', foreign)
        void asyncSession
        const taken = await createMount(ctx)(blueprintOf({ count: 6 }), { token: 'app:foreign-async-takeover' })(createFakeHost({ connected: true }))
        expect(taken.token).toBe('app:foreign-async-takeover')
    })

    it('throws ASYNC_SERVICE_NOT_READY for token-pending sync mounts', async () => {
        const { ctx } = createWorld()
        let resolveGate!: (value: string) => void
        const gate = new Promise<string>((resolve) => {
            resolveGate = resolve
        })
        const bp = blueprintOf({ count: 0 }, [
            provider('app:eager', () => gate, { async: true, eager: true }),
        ])
        const pending = createMount(ctx)(bp, { token: 'app:token-pending' })(createFakeHost({ connected: true }))
        try {
            createMountSync(ctx)(bp, { token: 'app:token-pending' })(createFakeHost({ connected: true }))
            expect.unreachable()
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('ASYNC_SERVICE_NOT_READY')
        }
        resolveGate('done')
        await pending
    })

    it('runs sync onMount, reports sync throws, and rejects async onMount', () => {
        const { ctx } = createWorld()
        const order: Array<string> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', () => {
                order.push('sync-mount')
                return () => {
                    order.push('sync-cleanup')
                }
            }),
        ])
        const session = createMountSync(ctx)(bp)(createFakeHost({ connected: true }))
        expect(order).toEqual(['sync-mount'])
        createDispose(ctx)(session)
        expect(order).toEqual(['sync-mount', 'sync-cleanup'])
        const throwing = blueprintOf({ count: 0 }, [], [
            hook('mount', () => {
                throw new Error('sync-mount-broken')
            }),
        ])
        try {
            createMountSync(ctx)(throwing)(createFakeHost({ connected: true }))
            expect.unreachable()
        } catch (error) {
            expect(error).toBeInstanceOf(DocumentContextError)
            expect((error as DocumentContextError).code).toBe('HOOK_ERROR')
        }
        const asyncHook = blueprintOf({ count: 0 }, [], [
            hook('mount', () => Promise.resolve()),
        ])
        try {
            createMountSync(ctx)(asyncHook)(createFakeHost({ connected: true }))
            expect.unreachable()
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('ASYNC_SERVICE_NOT_READY')
        }
    })

    it('revives suspended sessions synchronously with resuscitate hooks and responder', async () => {
        const { ctx, scheduler } = createWorld()
        const hostA = createFakeHost({ connected: true })
        const events: Array<string> = []
        const bp = blueprintOf({ count: 8 }, [
            provider('app:theme', () => 'dark'),
        ], [
            hook('resuscitate', () => {
                events.push('resuscitated')
            }),
        ])
        const session = await createMount(ctx)(bp, { token: 'app:sync-hooks' })(hostA)
        hostA.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(true)
        const hostB = createFakeHost({ connected: true })
        const revived = createMountSync(ctx)(bp, { token: 'app:sync-hooks' })(hostB)
        expect(revived).toBe(session)
        expect(events).toEqual(['resuscitated'])
        expect(session.isSuspended).toBe(false)
        let answered: unknown
        hostB.dispatch('context-request', {
            detail: { token: 'app:theme', callback: (value: unknown) => { answered = value } },
        })
        expect(answered).toBe('dark')
    })

    it('answers eager singletons from the warmed cache without re-running factories', async () => {
        const { ctx } = createWorld()
        let calls = 0
        const bp = blueprintOf({ count: 0 }, [
            provider('app:warm-single', () => {
                calls += 1
                return { n: calls }
            }, { lifecycle: 'singleton', eager: true }),
        ])
        const host = createFakeHost({ connected: true })
        await createMount(ctx)(bp)(host)
        expect(calls).toBe(1)
        const answers: Array<unknown> = []
        for (let round = 0; round < 2; round += 1) {
            host.dispatch('context-request', {
                detail: { token: 'app:warm-single', callback: (value: unknown) => { answers.push(value) } },
            })
        }
        expect(calls).toBe(1)
        expect(answers[0]).toBe(answers[1])
    })

    it('mounts private-token singletons without document identity bookkeeping', async () => {
        const { ctx } = createWorld()
        const secret = { name: 'app:secret-single' } as Token
        const bp = blueprintOf({ count: 0 }, [
            {
                token: secret,
                factory: () => ({ classified: true }),
                lifecycle: 'singleton',
                async: false,
                multi: false,
                eager: true,
            },
        ])
        const host = createFakeHost({ connected: true })
        const session = await createMount(ctx)(bp)(host)
        expect(session.isDisposed).toBe(false)
        expect(ctx.singletons.has('app:secret-single')).toBe(false)
    })

    it('parks keyed mounts over foreign keyed entries without reclaiming them', async () => {
        const { ctx } = createWorld()
        const foreign = { kind: 'foreign-session' } as unknown as Session
        ctx.keyed.set('app:foreign-park', foreign)
        const host = createFakeHost({ connected: true })
        const bp = blueprintOf({ count: 3 })
        const pending = createMount(ctx)(bp, { token: 'app:foreign-park' })(host)
        host.setConnected(false)
        const parked = await pending
        expect(parked.isSuspended).toBe(true)
        expect(ctx.keyed.get('app:foreign-park')).toBe(foreign)
        host.setConnected(true)
        const revived = await createMount(ctx)(bp, { token: 'app:foreign-park' })(host)
        expect(revived).toBe(parked)
        expect(parked.isSuspended).toBe(false)
        expect(snapshotOf(parked)).toEqual({ count: 3 })
    })

    it('settles two async dispose hooks together before completing errors$', async () => {
        const { ctx } = createWorld()
        const settled: Array<string> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('dispose', async () => {
                await Promise.resolve()
                settled.push('first')
            }),
            hook('dispose', async () => {
                await Promise.resolve()
                await Promise.resolve()
                settled.push('second')
            }),
        ])
        const session = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        let errorsCompleted = false
        session.errors$.subscribe({ complete: () => { errorsCompleted = true } })
        createDispose(ctx)(session)
        expect(errorsCompleted).toBe(false)
        await tick()
        await tick()
        expect(settled.sort()).toEqual(['first', 'second'])
        expect(errorsCompleted).toBe(true)
    })
})

describe('mount keyed write order hygiene', () => {
    it('defers the identity write until after the responder install (async)', async () => {
        const { ctx, keys } = createWorld()
        const host = createFakeHost({ connected: true })
        let seenDuringMount: string | null | undefined
        let responderReadyDuringMount = false
        const bp = blueprintOf({ count: 0 }, [
            provider('app:order-check', () => 'ready'),
        ], [
            hook('mount', () => {
                seenDuringMount = keys.get(host.native())
                let answered: unknown
                host.dispatch('context-request', {
                    detail: { token: 'app:order-check', callback: (value: unknown) => { answered = value } },
                })
                responderReadyDuringMount = answered === 'ready'
            }),
        ])
        const session = await createMount(ctx)(bp, { token: 'app:order-hygiene' })(host)
        expect(seenDuringMount).toBeUndefined()
        expect(responderReadyDuringMount).toBe(false)
        expect(keys.get(host.native())).toBe('app:order-hygiene')
        let answered: unknown
        host.dispatch('context-request', {
            detail: { token: 'app:order-check', callback: (value: unknown) => { answered = value } },
        })
        expect(answered).toBe('ready')
        expect(session.token).toBe('app:order-hygiene')
    })

    it('defers the identity write until after the responder install (sync)', () => {
        const { ctx, keys } = createWorld()
        const host = createFakeHost({ connected: true })
        let seenDuringMount: string | null | undefined
        const bp = blueprintOf({ count: 0 }, [
            provider('app:sync-order', () => 'sync-ready'),
        ], [
            hook('mount', () => {
                seenDuringMount = keys.get(host.native())
            }),
        ])
        const session = createMountSync(ctx)(bp, { token: 'app:sync-hygiene' })(host)
        expect(seenDuringMount).toBeUndefined()
        expect(keys.get(host.native())).toBe('app:sync-hygiene')
        let answered: unknown
        host.dispatch('context-request', {
            detail: { token: 'app:sync-order', callback: (value: unknown) => { answered = value } },
        })
        expect(answered).toBe('sync-ready')
        expect(session.token).toBe('app:sync-hygiene')
    })

    it('marks sync mounts mounted immediately for scope answers', () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        const session = createMountSync(ctx)(blueprintOf({ count: 0 }, [
            provider('app:sync-visible', () => 'visible'),
        ]))(host)
        let answered: unknown
        host.dispatch('context-request', {
            detail: { token: 'app:sync-visible', callback: (value: unknown) => { answered = value } },
        })
        expect(answered).toBe('visible')
        expect(session.isSuspended).toBe(false)
        expect(session.isDisposed).toBe(false)
    })

    it('pushes mounted on fresh async mounts and resuscitated on revival', async () => {
        const { ctx, scheduler } = createWorld()
        const hostA = createFakeHost({ connected: true })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:life-cycle' })(hostA)
        const events: Array<string> = []
        session.lifecycle$.subscribe((event) => {
            events.push(event.type)
        })
        hostA.setConnected(false)
        scheduler.flushMicrotasks()
        expect(events).toEqual(['suspended'])
        const hostB = createFakeHost({ connected: true })
        const revived = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:life-cycle' })(hostB)
        expect(revived).toBe(session)
        expect(events).toEqual(['suspended', 'resuscitated'])
    })

    it('writes the resuscitated identity only after the responder answers', async () => {
        const { ctx, keys, scheduler } = createWorld()
        const hostA = createFakeHost({ connected: true })
        const bp = blueprintOf({ count: 0 }, [
            provider('app:revive-check', () => 'revived-ready'),
        ])
        const session = await createMount(ctx)(bp, { token: 'app:revive-order' })(hostA)
        hostA.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(true)
        const hostB = createFakeHost({ connected: true })
        const revived = await createMount(ctx)(bp, { token: 'app:revive-order' })(hostB)
        expect(revived).toBe(session)
        expect(keys.get(hostB.native())).toBe('app:revive-order')
        let answered: unknown
        hostB.dispatch('context-request', {
            detail: { token: 'app:revive-check', callback: (value: unknown) => { answered = value } },
        })
        expect(answered).toBe('revived-ready')
    })
})

describe('mount persist write-back', () => {
    const readEnvelope = (storage: FakeStorageHandle, key: string): { v: number, d: Record<string, unknown> } | undefined => {
        const raw = storage.contents().get(key)
        if (raw === undefined) {
            return undefined
        }
        return JSON.parse(raw) as { v: number, d: Record<string, unknown> }
    }

    const updateCount = (ctx: ApplicationContext, session: Session, count: number): void => {
        const record = ctx.records.get(session as unknown as object)
        if (record === undefined) {
            throw new Error('missing record')
        }
        record.sessionState.update({ count })
    }

    it('writes back coalesced updates with the version envelope', async () => {
        const { ctx, scheduler, storages } = createWorld()
        const storage = createFakeStorage()
        storages.set('memory', storage.port)
        const session = await createMount(ctx)(
            blueprintOf({ count: 0 }, [], [], { storage: 'memory', key: 'app:wb-coalesce', version: 2 }),
        )(createFakeHost({ connected: true }))
        updateCount(ctx, session, 1)
        updateCount(ctx, session, 2)
        expect(scheduler.pendingMicrotasks()).toBe(1)
        scheduler.flushMicrotasks()
        expect(readEnvelope(storage, 'app:wb-coalesce')).toEqual({ v: 2, d: { count: 2 } })
    })

    it('flushes pending writes on dispose', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storages.set('memory', storage.port)
        const session = await createMount(ctx)(
            blueprintOf({ count: 0 }, [], [], { storage: 'memory', key: 'app:wb-dispose' }),
        )(createFakeHost({ connected: true }))
        updateCount(ctx, session, 6)
        createDispose(ctx)(session)
        expect(readEnvelope(storage, 'app:wb-dispose')).toEqual({ v: 0, d: { count: 6 } })
        expect(session.isDisposed).toBe(true)
    })

    it('lets remounts read back the flushed value', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storages.set('memory', storage.port)
        const bp = blueprintOf({ count: 0 }, [], [], { storage: 'memory', key: 'app:wb-remount' })
        const first = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        updateCount(ctx, first, 5)
        createDispose(ctx)(first)
        const second = await createMount(ctx)(bp)(createFakeHost({ connected: true }))
        expect(snapshotOf(second)).toEqual({ count: 5 })
    })

    it('never writes when hydrate is newer-blocked and reports the guard once', async () => {
        const { ctx, scheduler, storages } = createWorld()
        const storage = createFakeStorage()
        storage.port.write('app:wb-blocked', JSON.stringify({ v: 3, d: { count: 100 } }))
        storages.set('memory', storage.port)
        const session = await createMount(ctx)(
            blueprintOf({ count: 8 }, [], [], { storage: 'memory', key: 'app:wb-blocked', version: 1 }),
        )(createFakeHost({ connected: true }))
        expect(snapshotOf(session)).toEqual({ count: 8 })
        const codes: Array<string> = []
        const details: Array<unknown> = []
        session.errors$.subscribe((error) => {
            codes.push(error.code)
            details.push(error.details)
        })
        expect(codes).toEqual(['INVALID_STORAGE_DATA'])
        updateCount(ctx, session, 9)
        scheduler.flushMicrotasks()
        expect(storage.contents().get('app:wb-blocked')).toBe(JSON.stringify({ v: 3, d: { count: 100 } }))
        expect(codes).toEqual(['INVALID_STORAGE_DATA', 'INVALID_STORAGE_DATA'])
        expect(details[1]).toEqual({ op: 'write', guarded: true })
        updateCount(ctx, session, 10)
        scheduler.flushMicrotasks()
        expect(codes).toHaveLength(2)
        expect(storage.contents().get('app:wb-blocked')).toBe(JSON.stringify({ v: 3, d: { count: 100 } }))
    })

    it('applies external snapshots flush-then-compare without echo', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storages.set('memory', storage.port)
        const session = await createMount(ctx)(
            blueprintOf({ count: 0 }, [], [], { storage: 'memory', key: 'app:wb-remote' }),
        )(createFakeHost({ connected: true }))
        updateCount(ctx, session, 1)
        storage.emitExternal('app:wb-remote', envelope({ count: 9 }))
        // D-100 flush-then-compare plus the persist-wiring no-echo apply: the
        // pending local batch lands in the backend first, then the remote wins
        // the state without scheduling a write-back echo.
        expect(snapshotOf(session)).toEqual({ count: 9 })
        expect(readEnvelope(storage, 'app:wb-remote')).toEqual({ v: 0, d: { count: 1 } })
    })

    it('drops external snapshots under ignore-external', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storages.set('memory', storage.port)
        const session = await createMount(ctx)(
            blueprintOf({ count: 0 }, [], [], { storage: 'memory', key: 'app:wb-ignore', conflict: 'ignore-external' }),
        )(createFakeHost({ connected: true }))
        storage.emitExternal('app:wb-ignore', envelope({ count: 9 }))
        expect(snapshotOf(session)).toEqual({ count: 0 })
    })

    it('reports corrupt external payloads and keeps running', async () => {
        const { ctx, storages } = createWorld()
        const storage = createFakeStorage()
        storages.set('memory', storage.port)
        const session = await createMount(ctx)(
            blueprintOf({ count: 0 }, [], [], { storage: 'memory', key: 'app:wb-corrupt' }),
        )(createFakeHost({ connected: true }))
        const codes: Array<string> = []
        session.errors$.subscribe((error) => {
            codes.push(error.code)
        })
        storage.emitExternal('app:wb-corrupt', 'not-json{{{')
        expect(snapshotOf(session)).toEqual({ count: 0 })
        expect(codes).toEqual(['INVALID_STORAGE_DATA'])
        storage.emitExternal('app:wb-corrupt', envelope({ count: 3 }))
        expect(snapshotOf(session)).toEqual({ count: 3 })
        expect(codes).toEqual(['INVALID_STORAGE_DATA'])
    })

    it('skips observe wiring when crossTab is false but still writes back', async () => {
        const { ctx, scheduler, storages } = createWorld()
        const storage = createFakeStorage()
        storages.set('memory', storage.port)
        const session = await createMount(ctx)(
            blueprintOf({ count: 0 }, [], [], { storage: 'memory', key: 'app:wb-notab', crossTab: false }),
        )(createFakeHost({ connected: true }))
        storage.emitExternal('app:wb-notab', envelope({ count: 9 }))
        expect(snapshotOf(session)).toEqual({ count: 0 })
        updateCount(ctx, session, 2)
        scheduler.flushMicrotasks()
        expect(readEnvelope(storage, 'app:wb-notab')).toEqual({ v: 0, d: { count: 2 } })
    })

    it('buffers mid-hydration externals and delivers them post-hydration', async () => {
        const { ctx } = createWorld()
        const backing = createFakeStorage()
        const subject = new Subject<string | null>()
        let resolveRead!: (result: { readonly ok: true, readonly value: string | null }) => void
        const gate = new Promise<{ readonly ok: true, readonly value: string | null }>((resolve) => {
            resolveRead = resolve
        })
        const asyncPort: StoragePort = {
            read: () => gate,
            write: (key, value) => backing.port.write(key, value),
            remove: (key) => backing.port.remove(key),
            observe$: () => subject.asObservable(),
        }
        const pending = createMount(ctx)(
            blueprintOf({ count: 0 }, [], [], { storage: asyncPort, key: 'app:wb-mid' }),
        )(createFakeHost({ connected: true }))
        subject.next(envelope({ count: 7 }))
        resolveRead({ ok: true, value: null })
        const session = await pending
        expect(snapshotOf(session)).toEqual({ count: 7 })
    })

    it('wires write-back for sync mounts', () => {
        const { ctx, scheduler, storages } = createWorld()
        const storage = createFakeStorage()
        storages.set('memory', storage.port)
        const session = createMountSync(ctx)(
            blueprintOf({ count: 0 }, [], [], { storage: 'memory', key: 'app:wb-sync' }),
        )(createFakeHost({ connected: true }))
        updateCount(ctx, session, 4)
        scheduler.flushMicrotasks()
        expect(readEnvelope(storage, 'app:wb-sync')).toEqual({ v: 0, d: { count: 4 } })
    })
})
