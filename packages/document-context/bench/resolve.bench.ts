// @vitest-environment node
import { bench, describe } from 'vitest'
import { firstValueFrom } from 'rxjs'
import { Subject } from 'rxjs'
import { DocumentContextError } from '../src/domain/model/errors.js'
import type { ContextBlueprint } from '../src/domain/model/blueprint.js'
import type { ServiceRegistration } from '../src/domain/model/service.js'
import type { Token } from '../src/domain/model/token.js'
import type { HostPort } from '../src/domain/ports/host.js'
import type { StoragePort } from '../src/domain/ports/storage.js'
import type { Session } from '../src/domain/model/session.js'
import type { MountSessionRecord } from '../src/domain/usecases/mount.js'
import {
    createFakeHost,
    createFakeScheduler,
    createFakeScopeTransport,
} from '../src/domain/testing/fakes.js'
import type { FakeHost, FakeScheduler } from '../src/domain/testing/fakes.js'
import { createMountSync } from '../src/application/api/mount.js'
import { createInjection } from '../src/application/api/inject.js'
import type { InjectionContext } from '../src/application/api/inject.js'
import type { ApplicationContext } from '../src/application/context.js'

type AnySession = Session<Record<PropertyKey, unknown>, unknown>

interface BenchWorld {
    readonly ctx: ApplicationContext
    readonly scheduler: FakeScheduler
}

const createWorld = (): BenchWorld => {
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
    return { ctx, scheduler }
}

const syncReg = (
    token: string,
    factory: () => unknown,
    extra: Partial<ServiceRegistration> = {},
): ServiceRegistration => ({
    token,
    factory: factory as ServiceRegistration['factory'],
    lifecycle: 'scoped',
    async: false,
    multi: false,
    eager: false,
    ...extra,
})

const blueprintOf = (
    initial: Record<PropertyKey, unknown>,
    providers: ReadonlyArray<ServiceRegistration> = [],
): ContextBlueprint<Record<PropertyKey, unknown>> => {
    const map = new Map<Token, ServiceRegistration>()
    for (const registration of providers) {
        map.set(registration.token, registration)
    }
    return { initial, providers: map, hooks: [], storage: null }
}

const { ctx } = createWorld()
const mountSync = createMountSync(ctx)
const { inject, inject$, injectAll, injectAllSync, injectSync } = createInjection(ctx as unknown as InjectionContext)

let transientCounter = 0

const solo = mountSync(blueprintOf({ count: 0 }, [
    syncReg('bench:scoped', () => ({ role: 'scoped' })),
    syncReg('bench:transient', () => ({ n: transientCounter += 1 }), { lifecycle: 'transient' }),
    syncReg('bench:single', () => ({ role: 'singleton' }), { lifecycle: 'singleton' }),
    {
        token: 'bench:async',
        factory: (async () => ({ role: 'async' })) as unknown as ServiceRegistration['factory'],
        lifecycle: 'scoped',
        async: true,
        multi: false,
        eager: false,
    },
]))(createFakeHost({ connected: true })) as unknown as AnySession

// Ancestor chain: token lives only on the root, five hops above the leaf.
let parent: HostPort | null = null
const chainHosts: Array<FakeHost> = []
for (let depth = 0; depth < 6; depth += 1) {
    const host = createFakeHost({ connected: true, parent })
    chainHosts.push(host)
    parent = host as unknown as HostPort
}
mountSync(blueprintOf({ depth: 0 }, [syncReg('bench:root', () => ({ role: 'root' }))]))(chainHosts[0] as unknown as HostPort)
for (let depth = 1; depth < 6; depth += 1) {
    mountSync(blueprintOf({ depth }))(chainHosts[depth] as unknown as HostPort)
}
const leaf = ((): AnySession => {
    const found = (ctx.sessions as unknown as Map<object, { facade: Session }>).get(
        (chainHosts[5] as FakeHost).native() as object,
    )
    if (found === undefined) {
        throw new Error('leaf session missing')
    }
    return found.facade as unknown as AnySession
})()

// Multi chain: eight sessions each contribute one 'bench:tag' registration;
// multi collection spans ancestor sessions, so the leaf sees all eight.
let multiParent: HostPort | null = null
let multiLeaf: AnySession | null = null
for (let index = 0; index < 8; index += 1) {
    const host = createFakeHost({ connected: true, parent: multiParent })
    multiParent = host as unknown as HostPort
    const session = mountSync(blueprintOf({ index }, [
        syncReg('bench:tag', () => ({ tag: index }), { multi: true }),
    ]))(host as unknown as HostPort) as unknown as AnySession
    multiLeaf = session
}
if (multiLeaf === null) {
    throw new Error('multi leaf session missing')
}
const multiTarget: AnySession = multiLeaf

const readScoped = injectSync('bench:scoped')
const readTransient = injectSync('bench:transient')
const readSingleton = injectSync('bench:single')
const readRoot = injectSync('bench:root')
const readTags = injectAllSync('bench:tag')

let sink: unknown = null
const options = { time: 100, warmupTime: 50 }

describe('resolve', () => {
    bench('injectSync: local scoped hit', () => {
        sink = readScoped(solo)
    }, options)

    bench('injectSync: transient fresh factory', () => {
        sink = readTransient(solo)
    }, options)

    bench('injectSync: singleton service', () => {
        sink = readSingleton(solo)
    }, options)

    bench('injectSync: ancestor walk (5 hops)', () => {
        sink = readRoot(leaf)
    }, options)

    bench('inject (async): local scoped hit', async () => {
        sink = await inject('bench:scoped')(solo)
    }, options)

    bench('inject (async): async factory', async () => {
        sink = await inject('bench:async')(solo)
    }, options)

    bench('inject$: subscribe to first value', async () => {
        sink = await firstValueFrom(inject$('bench:scoped')(solo))
    }, options)

    bench('injectAllSync: 8 multi values', () => {
        sink = readTags(multiTarget)
    }, options)

    bench('injectAll (async): 8 multi values', async () => {
        sink = await injectAll('bench:tag')(multiTarget)
    }, options)
})
