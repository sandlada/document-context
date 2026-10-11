// @vitest-environment node
import { bench, describe } from 'vitest'
import { Subject } from 'rxjs'
import type { Subscription } from 'rxjs'
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
import { createMountSync } from '../src/application/api/mount.js'
import { createUpdate } from '../src/application/api/update.js'
import { createSelection } from '../src/application/api/select.js'
import { createSubscribe } from '../src/application/api/subscribe.js'
import type { ApplicationContext } from '../src/application/context.js'

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

interface CounterState extends Record<PropertyKey, unknown> {
    count: number
}

const blueprint: ContextBlueprint<CounterState> = {
    initial: { count: 0 },
    providers: new Map<Token, ServiceRegistration>(),
    hooks: [],
    storage: null,
}

const { ctx } = createWorld()
const mountSync = createMountSync(ctx)
const update = createUpdate(ctx)
const { selectSync } = createSelection(ctx)
const subscribe$ = createSubscribe(ctx)

const plain = mountSync(blueprint)(createFakeHost({ connected: true }))
const fanned = mountSync(blueprint)(createFakeHost({ connected: true }))

// Persistent fan-out for the fan-out bench: ten live listeners on `fanned` only.
const fanoutSubscriptions: Array<Subscription> = []
for (let index = 0; index < 10; index += 1) {
    fanoutSubscriptions.push(subscribe$((_state: CounterState) => {})(fanned))
}
void fanoutSubscriptions

const readCount = selectSync((state: CounterState) => state.count)

let n = 0
let sink: unknown = null
const options = { time: 100, warmupTime: 50 }

describe('update', () => {
    bench('update: partial-object throughput', () => {
        n += 1
        update({ count: n })(plain)
    }, options)

    bench('update: updater-function throughput', () => {
        update((prev: CounterState) => ({ count: prev.count + 1 }))(plain)
    }, options)

    bench('update: fan-out to 10 subscribers', () => {
        n += 1
        update({ count: n })(fanned)
    }, options)

    bench('selectSync: memo hit (unchanged state)', () => {
        sink = readCount(plain)
    }, options)

    bench('selectSync: memo miss (update then read)', () => {
        n += 1
        update({ count: n })(plain)
        sink = readCount(plain)
    }, options)

    bench('subscribe$: subscribe/unsubscribe churn', () => {
        const subscription = subscribe$((_state: CounterState) => {})(plain)
        subscription.unsubscribe()
    }, options)
})
