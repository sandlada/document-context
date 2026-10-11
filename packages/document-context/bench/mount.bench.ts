// @vitest-environment node
import { bench, describe } from 'vitest'
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
import type { FakeScheduler } from '../src/domain/testing/fakes.js'
import { createMount, createMountSync } from '../src/application/api/mount.js'
import type { ApplicationContext } from '../src/application/context.js'

interface BenchWorld {
    readonly ctx: ApplicationContext
    readonly scheduler: FakeScheduler
    readonly mount: ReturnType<typeof createMount>
    readonly mountSync: ReturnType<typeof createMountSync>
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
    return { ctx, scheduler, mount: createMount(ctx), mountSync: createMountSync(ctx) }
}

const reg = (token: string, eager = false): ServiceRegistration => ({
    token,
    factory: (() => ({ created: true })) as ServiceRegistration['factory'],
    lifecycle: 'scoped',
    async: false,
    multi: false,
    eager,
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

const providerNames = (count: number, prefix: string): Array<ServiceRegistration> => {
    const registrations: Array<ServiceRegistration> = []
    for (let index = 0; index < count; index += 1) {
        registrations.push(reg(`${prefix}:service-${index}`))
    }
    return registrations
}

const { mount, mountSync } = createWorld()

const smallBlueprint = blueprintOf({ count: 0 })
const mediumBlueprint = blueprintOf({ count: 0 }, providerNames(8, 'bench:medium'))
const largeBlueprint = blueprintOf({ count: 0 }, providerNames(32, 'bench:large'))
const eagerBlueprint = blueprintOf({ count: 0 }, providerNames(4, 'bench:eager').map((registration) => ({
    ...registration,
    eager: true,
})))

const runSmall = mountSync(smallBlueprint)
const runMedium = mountSync(mediumBlueprint)
const runLarge = mountSync(largeBlueprint)
const runEager = mountSync(eagerBlueprint)
const runAsyncSmall = mount(smallBlueprint)
const runAsyncMedium = mount(mediumBlueprint)

// Keyed mounts need a fresh identity per iteration: reusing one token would
// hit the live keyed-session path instead of a fresh mount.
let keyedCounter = 0

const options = { time: 100, warmupTime: 50 }

describe('mount', () => {
    bench('mountSync: seed-only blueprint', () => {
        runSmall(createFakeHost({ connected: true }))
    }, options)

    bench('mountSync: 8-provider blueprint', () => {
        runMedium(createFakeHost({ connected: true }))
    }, options)

    bench('mountSync: 32-provider blueprint', () => {
        runLarge(createFakeHost({ connected: true }))
    }, options)

    bench('mountSync: 4 eager sync providers', () => {
        runEager(createFakeHost({ connected: true }))
    }, options)

    bench('mountSync: keyed identity', () => {
        keyedCounter += 1
        mountSync(smallBlueprint, { token: `bench:box-${keyedCounter}` })(createFakeHost({ connected: true }))
    }, options)

    bench('mount (async): seed-only blueprint', async () => {
        await runAsyncSmall(createFakeHost({ connected: true }))
    }, options)

    bench('mount (async): 8-provider blueprint', async () => {
        await runAsyncMedium(createFakeHost({ connected: true }))
    }, options)
})
