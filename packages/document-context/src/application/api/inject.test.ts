import type { Observable } from 'rxjs'
import { EMPTY } from 'rxjs'
import { describe, expect, it } from 'vitest'
import {
    DocumentContextError,
    definePrivateToken,
    mountSession,
} from '../../domain/index.js'
import type {
    ContextBlueprint,
    HostPort,
    MountSessionRecord,
    ServiceRegistration,
    Session,
    Token,
} from '../../domain/index.js'
import { createFakeHost, createFakeScheduler, createFakeScopeTransport } from '../../domain/testing/fakes.js'
import type { FakeHost, FakeScheduler, FakeScopeWorld } from '../../domain/testing/fakes.js'
import { createInjection } from './inject.js'
import type { InjectionContext } from './inject.js'

type AnySession = Session<Record<PropertyKey, unknown>, unknown>
type AnyRecord = MountSessionRecord<Record<PropertyKey, unknown>>

interface IndexedRecord {
    readonly singles: Map<Token, ServiceRegistration>
    readonly multis: Map<Token, Array<ServiceRegistration>>
}

interface Mounted {
    readonly host: FakeHost
    readonly native: unknown
    readonly facade: AnySession
    readonly record: AnyRecord & IndexedRecord
    readonly dispose: () => void
}

interface Setup {
    readonly ctx: InjectionContext
    readonly scheduler: FakeScheduler
    readonly world: FakeScopeWorld
    readonly mount: (opts?: {
        readonly parent?: HostPort<unknown> | null
        readonly token?: string | null
        readonly initial?: Record<PropertyKey, unknown>
        readonly singles?: ReadonlyArray<ServiceRegistration>
        readonly multis?: ReadonlyArray<ServiceRegistration>
    }) => Promise<Mounted>
}

const syncReg = (
    token: string,
    value: unknown,
    extra: Partial<ServiceRegistration> = {},
): ServiceRegistration => ({
    token,
    factory: () => value,
    lifecycle: 'scoped',
    async: false,
    multi: false,
    eager: false,
    ...extra,
})

const asyncReg = (
    token: string,
    value: unknown,
    extra: Partial<ServiceRegistration> = {},
): ServiceRegistration => ({
    token,
    factory: async () => value,
    lifecycle: 'scoped',
    async: true,
    multi: false,
    eager: false,
    ...extra,
})

const setup = (withSsr = false): Setup => {
    const scheduler = createFakeScheduler()
    const world = createFakeScopeTransport()
    const natives = new Map<unknown, FakeHost>()
    const sessions = new Map<unknown, { readonly facade: AnySession, readonly record: AnyRecord }>()
    const records = new WeakMap<object, AnyRecord>()
    const singletons = new Map<unknown, unknown>()
    const ctx: InjectionContext = {
        ports: {
            host: {
                toHost: (native: unknown): HostPort<unknown> => {
                    const found = natives.get(native)
                    if (found === undefined) {
                        throw new DocumentContextError('HOST_INVALID', { reason: 'unknown-native' })
                    }
                    return found
                },
                scheduler,
                scopeTransport: world.transport,
            },
            ...(withSsr ? { ssr: { kind: 'server' } } : {}),
        },
        sessions,
        records,
        singletons,
    }
    const mount = async (opts: {
        readonly parent?: HostPort<unknown> | null
        readonly token?: string | null
        readonly initial?: Record<PropertyKey, unknown>
        readonly singles?: ReadonlyArray<ServiceRegistration>
        readonly multis?: ReadonlyArray<ServiceRegistration>
    } = {}): Promise<Mounted> => {
        const host = createFakeHost({ connected: true, parent: opts.parent ?? null, token: opts.token ?? null })
        natives.set(host.native(), host)
        const blueprint: ContextBlueprint<Record<PropertyKey, unknown>> = {
            initial: { ...(opts.initial ?? {}) },
            providers: new Map(),
            hooks: [],
            storage: null,
        }
        const mounted = mountSession({
            blueprint,
            host,
            kind: opts.token ? 'keyed' : 'anonymous',
            token: opts.token ?? null,
            ports: { scheduler },
        })
        await mounted.ready
        const singles = new Map<Token, ServiceRegistration>()
        for (const reg of opts.singles ?? []) {
            singles.set(reg.token, reg)
        }
        const multis = new Map<Token, Array<ServiceRegistration>>()
        for (const reg of opts.multis ?? []) {
            const list = multis.get(reg.token)
            if (list === undefined) {
                multis.set(reg.token, [reg])
            } else {
                list.push(reg)
            }
        }
        const record = Object.assign(mounted.record, { singles, multis }) as AnyRecord & IndexedRecord
        const facade = {
            get host(): HostPort<unknown> {
                return record.host as HostPort<unknown>
            },
            token: opts.token ?? null,
            get isConnected(): boolean {
                return (record.host as HostPort<unknown>).isConnected
            },
            get isSuspended(): boolean {
                return record.status === 'suspended'
            },
            get isDisposed(): boolean {
                return record.status === 'disposed'
            },
            abortSignal: record.abortController.signal,
            state$: record.sessionState.state$,
            errors$: EMPTY as unknown as Observable<DocumentContextError>,
            lifecycle$: EMPTY as unknown as Observable<never>,
            abort$: record.abort$,
        } as unknown as AnySession
        sessions.set(host.native(), { facade, record })
        records.set(facade, record)
        return { host, native: host.native(), facade, record, dispose: () => mounted.dispose() }
    }
    return { ctx, scheduler, world, mount }
}

const collect = <T>(observable: Observable<T>): {
    readonly values: Array<T>
    readonly errors: Array<unknown>
    readonly completed: () => boolean
    readonly unsubscribe: () => void
} => {    const values: Array<T> = []
    const errors: Array<unknown> = []
    let done = false
    const subscription = observable.subscribe({
        next: (value) => {
            values.push(value)
        },
        error: (error: unknown) => {
            errors.push(error)
        },
        complete: () => {
            done = true
        },
    })
    return {
        values,
        errors,
        completed: () => done,
        unsubscribe: () => subscription.unsubscribe(),
    }
}

const flushMicrotasks = async (rounds = 10): Promise<void> => {
    for (let round = 0; round < rounds; round += 1) {
        await Promise.resolve()
    }
}

describe('inject token validation', () => {
    it('throws TOKEN_INVALID for a bare string without a namespace (sync)', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { facade } = await mount({ singles: [syncReg('app:user', { id: 'u1' })] })
        expect(() => api.injectSync('no-namespace')(facade)).toThrowError(DocumentContextError)
        try {
            api.injectSync('no-namespace')(facade)
            throw new Error('expected TOKEN_INVALID')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('TOKEN_INVALID')
        }
    })

    it('emits TOKEN_INVALID on the Observable face for an invalid string', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { native } = await mount()
        const collected = collect(api.inject$('bad token!')(native))
        expect(collected.values).toEqual([])
        expect(collected.errors).toHaveLength(1)
        expect((collected.errors[0] as DocumentContextError).code).toBe('TOKEN_INVALID')
    })

    it('rejects TOKEN_INVALID on the Promise face for an invalid string', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { native } = await mount()
        await expect(api.inject('__system__:x')(native)).rejects.toMatchObject({ code: 'TOKEN_INVALID' })
    })

    it('exempts private tokens from namespace validation', async () => {
        const secret = definePrivateToken<{ classified: string }>('not a valid name at all!!!')
        const { ctx: ctx2, mount: mount2 } = setup()
        const api = createInjection(ctx2)
        const { facade } = await mount2({
            singles: [{
                token: secret,
                factory: () => ({ classified: 'yes' }),
                lifecycle: 'scoped',
                async: false,
                multi: false,
                eager: false,
            }],
        })
        expect(api.injectSync(secret)(facade)).toEqual({ classified: 'yes' })
    })
})

describe('injectSync single-value', () => {
    it('resolves the nearest registration (nearest-wins)', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const root = await mount({ singles: [syncReg('app:theme', 'root')] })
        const leaf = await mount({ parent: root.host, singles: [syncReg('app:theme', 'leaf')] })
        expect(api.injectSync('app:theme')(leaf.facade)).toBe('leaf')
        expect(api.injectSync('app:theme')(root.facade)).toBe('root')
    })

    it('throws UNKNOWN_SERVICE when nothing is registered', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { facade } = await mount()
        try {
            api.injectSync('app:missing')(facade)
            throw new Error('expected UNKNOWN_SERVICE')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('UNKNOWN_SERVICE')
            expect((error as DocumentContextError).details).toEqual({ token: 'app:missing' })
        }
    })

    it('throws UNKNOWN_SERVICE for multi-only tokens on single-fetch', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { facade } = await mount({ multis: [{ ...syncReg('app:tag', 'a'), multi: true }] })
        try {
            api.injectSync('app:tag')(facade)
            throw new Error('expected UNKNOWN_SERVICE')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('UNKNOWN_SERVICE')
        }
    })

    it('throws ASYNC_SERVICE_NOT_READY for promise values and async-flagged registrations', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const promised = await mount({ singles: [syncReg('app:late', Promise.resolve('x'))] })
        const flagged = await mount({ singles: [asyncReg('app:flagged', 'x')] })
        expect(() => api.injectSync('app:late')(promised.facade)).toThrowError(
            expect.objectContaining({ code: 'ASYNC_SERVICE_NOT_READY' }),
        )
        expect(() => api.injectSync('app:flagged')(flagged.facade)).toThrowError(
            expect.objectContaining({ code: 'ASYNC_SERVICE_NOT_READY' }),
        )
    })

    it('passes the owning session facade to the factory', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let seen: unknown = null
        const { facade } = await mount({
            singles: [{
                ...syncReg('app:echo', 'echoed'),
                factory: (session: unknown) => {
                    seen = session
                    return 'echoed'
                },
            }],
        })
        expect(api.injectSync('app:echo')(facade)).toBe('echoed')
        expect(seen).toBe(facade)
    })
})

describe('injectSync target rules', () => {
    it('throws UNKNOWN_SERVICE for non-Session targets (element and HostPort)', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { native, host } = await mount({ singles: [syncReg('app:user', 1)] })
        for (const target of [native, host]) {
            try {
                api.injectSync('app:user')(target as unknown as AnySession)
                throw new Error('expected UNKNOWN_SERVICE')
            } catch (error) {
                expect((error as DocumentContextError).code).toBe('UNKNOWN_SERVICE')
            }
        }
    })

    it('throws DISPOSED_SESSION for a disposed explicit target', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const mounted = await mount({ singles: [syncReg('app:user', 1)] })
        mounted.dispose()
        try {
            api.injectSync('app:user')(mounted.facade)
            throw new Error('expected DISPOSED_SESSION')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('DISPOSED_SESSION')
        }
    })

    it('throws DISPOSED_SESSION for an unknown Session handle', async () => {
        const { ctx } = setup()
        const api = createInjection(ctx)
        const stranger = { state$: null, host: null } as unknown as AnySession
        expect(() => api.injectSync('app:user')(stranger)).toThrowError(
            expect.objectContaining({ code: 'DISPOSED_SESSION' }),
        )
    })
})

describe('injectAllSync multi-value', () => {
    it('collects bottomUp (nearest-first) by default across scopes', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const root = await mount({ multis: [{ ...syncReg('app:tag', 'far'), multi: true }] })
        const leaf = await mount({
            parent: root.host,
            multis: [{ ...syncReg('app:tag', 'near'), multi: true }],
        })
        expect(api.injectAllSync('app:tag')(leaf.facade)).toEqual(['near', 'far'])
    })

    it('collects topDown (farthest-first) when requested', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const root = await mount({ multis: [{ ...syncReg('app:tag', 'far'), multi: true }] })
        const leaf = await mount({
            parent: root.host,
            multis: [{ ...syncReg('app:tag', 'near'), multi: true }],
        })
        expect(api.injectAllSync('app:tag', { direction: 'topDown' })(leaf.facade)).toEqual(['far', 'near'])
    })

    it('returns an empty snapshot when nothing is registered', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { facade } = await mount()
        expect(api.injectAllSync('app:missing')(facade)).toEqual([])
    })

    it('fails the whole fetch when any entry is unready (no partial skip)', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { facade } = await mount({
            multis: [
                { ...syncReg('app:tag', 'ready'), multi: true },
                { ...asyncReg('app:tag', 'late'), multi: true },
            ],
        })
        try {
            api.injectAllSync('app:tag')(facade)
            throw new Error('expected ASYNC_SERVICE_NOT_READY')
        } catch (error) {
            expect((error as DocumentContextError).code).toBe('ASYNC_SERVICE_NOT_READY')
        }
    })
})

describe('inject$ cold resolve-once', () => {
    it('is cold: no factory work before subscribe, then emits once and completes', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let calls = 0
        const { native } = await mount({
            singles: [{
                ...syncReg('app:user', { id: 'u1' }),
                factory: () => {
                    calls += 1
                    return { id: 'u1' }
                },
            }],
        })
        const stream = api.inject$('app:user')(native)
        expect(calls).toBe(0)
        const collected = collect(stream)
        expect(calls).toBe(1)
        await flushMicrotasks()
        expect(collected.values).toEqual([{ id: 'u1' }])
        expect(collected.completed()).toBe(true)
    })

    it('gives each subscription a fresh transient instance', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let calls = 0
        const { native } = await mount({
            singles: [{
                ...syncReg('app:tmp', null),
                lifecycle: 'transient',
                factory: () => {
                    calls += 1
                    return { n: calls }
                },
            }],
        })
        const first = collect(api.inject$('app:tmp')(native))
        const second = collect(api.inject$('app:tmp')(native))
        expect(calls).toBe(2)
        await flushMicrotasks()
        expect(first.values[0]).not.toBe(second.values[0])
    })

    it('reuses one scoped instance across subscriptions (per-session cache)', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let calls = 0
        const { native } = await mount({
            singles: [{
                ...asyncReg('app:cached', null),
                factory: async () => {
                    calls += 1
                    return { n: calls }
                },
            }],
        })
        const first = collect(api.inject$('app:cached')(native))
        await Promise.resolve()
        await Promise.resolve()
        const second = collect(api.inject$('app:cached')(native))
        await Promise.resolve()
        await Promise.resolve()
        expect(calls).toBe(1)
        expect(first.values[0]).toBe(second.values[0])
    })
})

describe('inject order-independent pending', () => {
    it('pends before the provider exists and resolves on provide (inject first, mount later)', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const collected = collect(api.inject$('app:late')(leaf))
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(false)
        fns.world.provide('app:late', 'woken', leaf)
        expect(collected.values).toEqual(['woken'])
        expect(collected.completed()).toBe(true)
    })

    it('resolves the Promise face after a late provide', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const promise = api.inject('app:late')(leaf)
        const assertion = expect(promise).resolves.toBe('woken')
        fns.world.provide('app:late', 'woken', leaf)
        await assertion
    })

    it('settles multi on the first non-empty snapshot', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const collected = collect(api.injectAll$('app:tags')(leaf))
        expect(collected.completed()).toBe(false)
        fns.world.provide('app:tags', 'one', leaf)
        expect(collected.completed()).toBe(true)
        expect(collected.values).toHaveLength(1)
        expect(collected.values[0]).toEqual(['one'])
    })

    it('resolves a Session-target pending wait when an ancestor provides late', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const { facade, host } = await fns.mount()
        const collected = collect(api.inject$('app:late')(facade))
        expect(collected.completed()).toBe(false)
        fns.world.provide('app:late', 'ancestor-value', host)
        expect(collected.values).toEqual(['ancestor-value'])
        expect(collected.completed()).toBe(true)
    })
})

describe('inject timeout and AbortSignal', () => {
    it('rejects with RESOLUTION_TIMEOUT when timeoutMs elapses while pending', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const promise = api.inject('app:missing', { timeoutMs: 10 })(leaf)
        const assertion = expect(promise).rejects.toMatchObject({
            code: 'RESOLUTION_TIMEOUT',
            details: { token: 'app:missing', timeoutMs: 10 },
        })
        expect(fns.scheduler.pendingTimeouts()).toBe(1)
        fns.scheduler.flushTimeouts()
        await assertion
        expect(fns.world.pendingCount()).toBe(0)
    })

    it('lets a hit win over a later timeout with no residual timer', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const promise = api.inject('app:race', { timeoutMs: 10 })(leaf)
        fns.world.provide('app:race', 'hit', leaf)
        await expect(promise).resolves.toBe('hit')
        expect(fns.scheduler.pendingTimeouts()).toBe(0)
        fns.scheduler.flushTimeouts()
    })

    it('completes immediately on a pre-aborted signal without touching the transport (Observable)', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const collected = collect(api.inject$('app:x', { signal: AbortSignal.abort() })(leaf))
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(true)
        expect(fns.world.pendingCount()).toBe(0)
    })

    it('rejects with signal.reason on a pre-aborted signal (Promise)', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const reason = new Error('custom-stop')
        await expect(api.inject('app:x', { signal: AbortSignal.abort(reason) })(leaf)).rejects.toBe(reason)
        expect(fns.world.pendingCount()).toBe(0)
    })

    it('completes the Observable on mid-wait abort (reason never enters the stream)', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const controller = new AbortController()
        const collected = collect(api.inject$('app:x', { signal: controller.signal })(leaf))
        controller.abort(new Error('ignored-reason'))
        expect(collected.values).toEqual([])
        expect(collected.errors).toEqual([])
        expect(collected.completed()).toBe(true)
        expect(fns.world.pendingCount()).toBe(0)
    })

    it('rejects the Promise with the custom reason on mid-wait abort', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const controller = new AbortController()
        const promise = api.inject('app:x', { signal: controller.signal })(leaf)
        const assertion = expect(promise).rejects.toBe('stop-now')
        controller.abort('stop-now')
        await assertion
        expect(fns.world.pendingCount()).toBe(0)
    })
})

describe('inject target death', () => {
    it('errors DISPOSED_SESSION on the Observable when the target session dies while pending', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const mounted = await fns.mount()
        const collected = collect(api.inject$('app:never')(mounted.facade))
        expect(collected.completed()).toBe(false)
        mounted.dispose()
        expect(collected.values).toEqual([])
        expect(collected.errors).toHaveLength(1)
        expect((collected.errors[0] as DocumentContextError).code).toBe('DISPOSED_SESSION')
    })

    it('rejects DISPOSED_SESSION on the Promise when the target session dies while pending', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const mounted = await fns.mount()
        const promise = api.inject('app:never')(mounted.facade)
        const assertion = expect(promise).rejects.toMatchObject({ code: 'DISPOSED_SESSION' })
        mounted.dispose()
        await assertion
    })

    it('does not terminate element-target waits on unrelated session death', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const mounted = await fns.mount()
        const leaf = fns.world.createHost()
        const collected = collect(api.inject$('app:late')(leaf))
        mounted.dispose()
        expect(collected.completed()).toBe(false)
        fns.world.provide('app:late', 'still-here', leaf)
        expect(collected.values).toEqual(['still-here'])
        collected.unsubscribe()
    })
})

describe('inject singleton first-wins', () => {
    it('coalesces concurrent resolutions into one factory call', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let calls = 0
        const { native } = await mount({
            singles: [{
                ...asyncReg('app:single', null),
                lifecycle: 'singleton',
                factory: async () => {
                    calls += 1
                    return { n: calls }
                },
            }],
        })
        const [first, second] = await Promise.all([
            api.inject('app:single')(native),
            api.inject('app:single')(native),
        ])
        expect(calls).toBe(1)
        expect(first).toBe(second)
    })

    it('returns the cached winner without invoking the factory again', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let calls = 0
        const { native } = await mount({
            singles: [{
                ...syncReg('app:single', null),
                lifecycle: 'singleton',
                factory: () => {
                    calls += 1
                    return { n: calls }
                },
            }],
        })
        const first = await api.inject('app:single')(native)
        const second = await api.inject('app:single')(native)
        expect(calls).toBe(1)
        expect(first).toBe(second)
    })

    it('evicts rejections so a later retry re-invokes (self-healing)', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let calls = 0
        const { native } = await mount({
            singles: [{
                ...asyncReg('app:flaky', null),
                lifecycle: 'singleton',
                factory: async () => {
                    calls += 1
                    if (calls === 1) {
                        throw new Error('boom')
                    }
                    return 'healed'
                },
            }],
        })
        await expect(api.inject('app:flaky')(native)).rejects.toThrow('boom')
        await expect(api.inject('app:flaky')(native)).resolves.toBe('healed')
        expect(calls).toBe(2)
    })
})

describe('inject misc edges', () => {
    it('rejects UNKNOWN_SERVICE for a Session target under ssr (fast-reject, no pending)', async () => {
        const { ctx, mount } = setup(true)
        const api = createInjection(ctx)
        const { facade } = await mount()
        await expect(api.inject('app:missing')(facade)).rejects.toMatchObject({ code: 'UNKNOWN_SERVICE' })
        const collected = collect(api.inject$('app:missing')(facade))
        expect(collected.errors).toHaveLength(1)
        expect((collected.errors[0] as DocumentContextError).code).toBe('UNKNOWN_SERVICE')
    })

    it('surfaces HOST_INVALID for garbage element targets', async () => {
        const { ctx } = setup()
        const api = createInjection(ctx)
        const collected = collect(api.inject$('app:x')(42 as unknown as never))
        expect(collected.errors).toHaveLength(1)
        expect((collected.errors[0] as DocumentContextError).code).toBe('HOST_INVALID')
        await expect(api.inject('app:x')(42 as unknown as never)).rejects.toMatchObject({ code: 'HOST_INVALID' })
    })

    it('resolves async registrations through the ancestor walk (no transport)', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const root = await mount({ singles: [asyncReg('app:remote', { id: 'r1' })] })
        const leaf = await mount({ parent: root.host })
        await expect(api.inject('app:remote')(leaf.native)).resolves.toEqual({ id: 'r1' })
    })

    it('is deadlock-honest: a scoped self-cycle settles via timeoutMs', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        let facadeRef: AnySession | null = null
        const { facade } = await fns.mount({
            singles: [{
                ...asyncReg('app:self', null),
                factory: async () => api.inject('app:self', { timeoutMs: 5 })(facadeRef as AnySession),
            }],
        })
        facadeRef = facade
        const promise = api.inject('app:self', { timeoutMs: 5 })(facade)
        const assertion = expect(promise).rejects.toMatchObject({ code: 'RESOLUTION_TIMEOUT' })
        fns.scheduler.flushAll()
        await assertion
    })

    it('fast-rejects multi faces for Session targets under ssr', async () => {
        const { ctx, mount } = setup(true)
        const api = createInjection(ctx)
        const { facade } = await mount()
        await expect(api.injectAll('app:missing')(facade)).rejects.toMatchObject({ code: 'UNKNOWN_SERVICE' })
        const collected = collect(api.injectAll$('app:missing')(facade))
        expect(collected.errors).toHaveLength(1)
        expect((collected.errors[0] as DocumentContextError).code).toBe('UNKNOWN_SERVICE')
    })

    it('throws TOKEN_INVALID for non-string, non-object tokens on every face', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { facade, native } = await mount()
        expect(() => api.injectSync(42 as unknown as string)(facade)).toThrowError(
            expect.objectContaining({ code: 'TOKEN_INVALID' }),
        )
        const collected = collect(api.inject$(42 as unknown as string)(native))
        expect(collected.errors).toHaveLength(1)
        expect((collected.errors[0] as DocumentContextError).code).toBe('TOKEN_INVALID')
        await expect(api.inject(42 as unknown as string)(native)).rejects.toMatchObject({ code: 'TOKEN_INVALID' })
        expect(() => api.injectAllSync(42 as unknown as string)(facade)).toThrowError(
            expect.objectContaining({ code: 'TOKEN_INVALID' }),
        )
    })

    it('errors DISPOSED_SESSION on async faces for unknown or disposed sessions', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const stranger = { state$: null, host: null } as unknown as AnySession
        const collected = collect(api.inject$('app:x')(stranger))
        expect(collected.errors).toHaveLength(1)
        expect((collected.errors[0] as DocumentContextError).code).toBe('DISPOSED_SESSION')
        await expect(api.inject('app:x')(stranger)).rejects.toMatchObject({ code: 'DISPOSED_SESSION' })
        const mounted = await mount({ singles: [syncReg('app:user', 1)] })
        mounted.dispose()
        await expect(api.inject('app:user')(mounted.facade)).rejects.toMatchObject({ code: 'DISPOSED_SESSION' })
        const multiCollected = collect(api.injectAll$('app:x')(mounted.facade))
        expect(multiCollected.errors).toHaveLength(1)
        expect((multiCollected.errors[0] as DocumentContextError).code).toBe('DISPOSED_SESSION')
    })
})

describe('inject application singleton slots', () => {
    it('honours the mount-track resolved marker shape without invoking the factory', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let calls = 0
        const { native } = await mount({
            singles: [{
                ...syncReg('app:marked', null),
                lifecycle: 'singleton',
                factory: () => {
                    calls += 1
                    return { n: calls }
                },
            }],
        })
        ctx.singletons.set('app:marked', { status: 'resolved', value: { winner: true } })
        await expect(api.inject('app:marked')(native)).resolves.toEqual({ winner: true })
        expect(calls).toBe(0)
    })

    it('falls through an unresolved claim marker to the registry', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { native } = await mount({
            singles: [syncReg('app:claimed', 'fresh')],
        })
        ctx.singletons.set('app:claimed', { status: 'resolved', value: undefined })
        await expect(api.inject('app:claimed')(native)).resolves.toBe('fresh')
    })

    it('awaits mount-track in-flight slots', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let calls = 0
        const { native } = await mount({
            singles: [{
                ...syncReg('app:slot', null),
                lifecycle: 'singleton',
                factory: () => {
                    calls += 1
                    return 'factory-value'
                },
            }],
        })
        let resolveSlot!: (value: string) => void
        const slot = new Promise<string>((resolve) => {
            resolveSlot = resolve
        })
        ctx.singletons.set('app:slot', { status: 'inflight', promise: slot })
        const pending = api.inject('app:slot')(native)
        resolveSlot('slot-value')
        await expect(pending).resolves.toBe('slot-value')
        expect(calls).toBe(0)
    })

    it('returns raw cached values and treats explicit undefined as absent', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let calls = 0
        const { native } = await mount({
            singles: [{
                ...syncReg('app:raw', null),
                lifecycle: 'singleton',
                factory: () => {
                    calls += 1
                    return { n: calls }
                },
            },
            syncReg('app:raw-primitive', 'primitive-reg', { lifecycle: 'singleton' })],
        })
        ctx.singletons.set('app:raw-primitive', 42)
        await expect(api.inject('app:raw-primitive')(native)).resolves.toBe(42)
        ctx.singletons.set('app:raw', undefined)
        const value = await api.inject('app:raw')(native)
        expect(value).toEqual({ n: 1 })
        expect(calls).toBe(1)
    })

    it('cancels the timeout timer on a mounted hit (no residual timer)', async () => {
        const { ctx, scheduler, mount } = setup()
        const api = createInjection(ctx)
        const { native } = await mount({ singles: [syncReg('app:hit', 'hit-value')] })
        await expect(api.inject('app:hit', { timeoutMs: 1000 })(native)).resolves.toBe('hit-value')
        expect(scheduler.pendingTimeouts()).toBe(0)
    })

    it('rejects CIRCULAR_DEPENDENCY for synchronously nested async resolutions', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        let facadeRef: AnySession | null = null
        const { facade } = await fns.mount({
            singles: [{
                ...asyncReg('app:nested', null),
                factory: () => api.inject('app:nested')(facadeRef as AnySession),
            }],
        })
        facadeRef = facade
        await expect(api.inject('app:nested')(facade)).rejects.toMatchObject({ code: 'CIRCULAR_DEPENDENCY' })
    })
})

describe('inject suspended and disposed visibility', () => {
    it('resolves suspended sessions through explicit Session targets', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const mounted = await mount({ singles: [syncReg('app:theme', 'dark')] })
        mounted.record.status = 'suspended'
        expect(api.injectSync('app:theme')(mounted.facade)).toBe('dark')
        expect(api.injectAllSync('app:theme')(mounted.facade)).toEqual([])
        mounted.record.status = 'mounted'
    })

    it('skips disposed entries along element walks', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const root = await fns.mount({ singles: [syncReg('app:theme', 'root-theme')] })
        const leaf = await fns.mount({ parent: root.host })
        root.dispose()
        const collected = collect(api.inject$('app:theme')(leaf.native))
        expect(collected.completed()).toBe(false)
        fns.world.provide('app:theme', 'woken', leaf.host)
        expect(collected.values).toEqual(['woken'])
        collected.unsubscribe()
    })

    it('pends element-target waits past suspended sessions', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const mounted = await fns.mount({ singles: [syncReg('app:theme', 'dark')] })
        mounted.record.status = 'suspended'
        const collected = collect(api.inject$('app:theme')(mounted.native))
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(false)
        fns.world.provide('app:theme', 'woken', mounted.host)
        expect(collected.values).toEqual(['woken'])
        collected.unsubscribe()
        mounted.record.status = 'mounted'
    })

    it('resolves an explicit session even when its host left the session map', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const mounted = await mount({ singles: [syncReg('app:mine', 'mine')] })
        const mutableSessions = ctx.sessions as unknown as Map<unknown, { readonly facade: AnySession, readonly record: AnyRecord }>
        mutableSessions.delete(mounted.native)
        expect(api.injectSync('app:mine')(mounted.facade)).toBe('mine')
    })

    it('resolves through a SyncServiceStore-shaped services field', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const mounted = await mount({ singles: [syncReg('app:shaped', 'shaped-value')] })
        const record = ctx.records.get(mounted.facade)
        expect(record).toBeDefined()
        const shaped = {
            ...(record as AnyRecord),
            services: {
                singles: (record as unknown as { readonly singles: unknown }).singles,
                multis: (record as unknown as { readonly multis: unknown }).multis,
                registry: (record as AnyRecord).services,
            },
        } as unknown as AnyRecord
        const mutableSessions = ctx.sessions as unknown as Map<unknown, { readonly facade: AnySession, readonly record: AnyRecord }>
        mutableSessions.set(mounted.native, { facade: mounted.facade, record: shaped })
        expect(api.injectSync('app:shaped')(mounted.facade)).toBe('shaped-value')
    })

    it('falls back to the transport for index-less session records', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const { facade, host, native } = await fns.mount()
        const record = fns.ctx.records.get(facade)
        expect(record).toBeDefined()
        const bare = {
            ...(record as AnyRecord),
            services: {} as AnyRecord['services'],
        } as unknown as AnyRecord
        delete (bare as unknown as Record<string, unknown>)['singles']
        delete (bare as unknown as Record<string, unknown>)['multis']
        const mutableSessions = fns.ctx.sessions as unknown as Map<unknown, { readonly facade: AnySession, readonly record: AnyRecord }>
        mutableSessions.set(native, { facade, record: bare })
        const collected = collect(api.inject$('app:late')(native))
        expect(collected.completed()).toBe(false)
        fns.world.provide('app:late', 'transport-value', host)
        expect(collected.values).toEqual(['transport-value'])
        collected.unsubscribe()
    })
})

describe('inject multi faces', () => {
    it('rejects UNKNOWN_SERVICE for non-Session targets on injectAllSync', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { native, host } = await mount({ multis: [{ ...syncReg('app:tag', 'a'), multi: true }] })
        for (const target of [native, host]) {
            try {
                api.injectAllSync('app:tag')(target as unknown as AnySession)
                throw new Error('expected UNKNOWN_SERVICE')
            } catch (error) {
                expect((error as DocumentContextError).code).toBe('UNKNOWN_SERVICE')
            }
        }
    })

    it('rejects DISPOSED_SESSION for disposed and unknown handles on injectAllSync', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const mounted = await mount()
        mounted.dispose()
        expect(() => api.injectAllSync('app:tag')(mounted.facade)).toThrowError(
            expect.objectContaining({ code: 'DISPOSED_SESSION' }),
        )
        const stranger = { state$: null, host: null } as unknown as AnySession
        expect(() => api.injectAllSync('app:tag')(stranger)).toThrowError(
            expect.objectContaining({ code: 'DISPOSED_SESSION' }),
        )
    })

    it('surfaces factory failures on the multi promise face', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { native } = await mount({
            multis: [{
                ...syncReg('app:bad-tag', null),
                multi: true,
                factory: () => {
                    throw new Error('multi-factory-broken')
                },
            }],
        })
        await expect(api.injectAll('app:bad-tag')(native)).rejects.toThrow('multi-factory-broken')
        const collected = collect(api.injectAll$('app:bad-tag')(native))
        await flushMicrotasks()
        expect(collected.errors).toHaveLength(1)
    })

    it('runs transient multi factories fresh per call', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let calls = 0
        const { native } = await mount({
            multis: [{
                ...syncReg('app:tmp-tag', null),
                multi: true,
                lifecycle: 'transient',
                factory: () => {
                    calls += 1
                    return `n${calls}`
                },
            }],
        })
        await expect(api.injectAll('app:tmp-tag')(native)).resolves.toEqual(['n1'])
        await expect(api.injectAll('app:tmp-tag')(native)).resolves.toEqual(['n2'])
    })

    it('rejects transient multi factory throws instead of throwing synchronously', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { native } = await mount({
            multis: [{
                ...syncReg('app:throw-tag', null),
                multi: true,
                lifecycle: 'transient',
                factory: () => {
                    throw new Error('transient-multi-broken')
                },
            }],
        })
        await expect(api.injectAll('app:throw-tag')(native)).rejects.toThrow('transient-multi-broken')
    })

    it('completes multi streams immediately on pre-aborted signals', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const collected = collect(api.injectAll$('app:x', { signal: AbortSignal.abort() })(leaf))
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(true)
        expect(fns.world.pendingCount()).toBe(0)
        const reason = new Error('multi-stop')
        await expect(api.injectAll('app:x', { signal: AbortSignal.abort(reason) })(leaf)).rejects.toBe(reason)
    })

    it('rejects multi promises with the custom reason on mid-wait abort', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const controller = new AbortController()
        const promise = api.injectAll('app:x', { signal: controller.signal })(leaf)
        const assertion = expect(promise).rejects.toBe('multi-stop')
        controller.abort('multi-stop')
        await assertion
        expect(fns.world.pendingCount()).toBe(0)
    })

    it('times out pending multi waits with RESOLUTION_TIMEOUT', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const promise = api.injectAll('app:missing-tags', { timeoutMs: 10 })(leaf)
        const assertion = expect(promise).rejects.toMatchObject({
            code: 'RESOLUTION_TIMEOUT',
            details: { token: 'app:missing-tags', timeoutMs: 10 },
        })
        fns.scheduler.flushTimeouts()
        await assertion
    })

    it('collects topDown multi snapshots from mounted sessions', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const root = await mount({ multis: [{ ...syncReg('app:tag', 'far'), multi: true }] })
        const leaf = await mount({
            parent: root.host,
            multis: [{ ...syncReg('app:tag', 'near'), multi: true }],
        })
        await expect(api.injectAll('app:tag', { direction: 'topDown' })(leaf.native)).resolves.toEqual(['far', 'near'])
    })

    it('resolves thenable transport values on multi faces', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const collected = collect(api.injectAll$('app:tags')(leaf))
        fns.world.provide('app:tags', Promise.resolve('async-one'), leaf)
        await Promise.resolve()
        await Promise.resolve()
        expect(collected.values).toHaveLength(1)
        expect(collected.values[0]).toEqual(['async-one'])
        expect(collected.completed()).toBe(true)
    })

    it('resolves thenable transport values on single faces', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const collected = collect(api.inject$('app:one')(leaf))
        fns.world.provide('app:one', Promise.resolve('async-hit'), leaf)
        await Promise.resolve()
        await Promise.resolve()
        expect(collected.values).toEqual(['async-hit'])
        expect(collected.completed()).toBe(true)
    })

    it('stops pending waits on early unsubscribe (single and multi)', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const leaf = fns.world.createHost()
        const single = collect(api.inject$('app:late')(leaf))
        const multi = collect(api.injectAll$('app:late-tags')(leaf))
        single.unsubscribe()
        multi.unsubscribe()
        fns.world.provide('app:late', 'too-late', leaf)
        fns.world.provide('app:late-tags', 'too-late', leaf)
        expect(single.values).toEqual([])
        expect(multi.values).toEqual([])
    })

    it('ignores late aborts after settlement', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { native } = await mount({ singles: [syncReg('app:hit', 'hit')] })
        const controller = new AbortController()
        const value = await api.inject('app:hit', { signal: controller.signal })(native)
        expect(value).toBe('hit')
        controller.abort(new Error('too-late'))
        const second = await api.inject('app:hit', { signal: controller.signal })(native).then(
            (hit) => hit,
            (reason: unknown) => reason,
        )
        expect(second).toBeInstanceOf(Error)
    })

    it('settles late on hit paths after an abort (exactly-once guards)', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let resolveFactory!: (value: string) => void
        const gate = new Promise<string>((resolve) => {
            resolveFactory = resolve
        })
        const { native } = await mount({
            singles: [{
                ...asyncReg('app:pending-hit', null),
                factory: () => gate,
            }],
        })
        const firstController = new AbortController()
        const first = collect(api.inject$('app:pending-hit', { signal: firstController.signal })(native))
        firstController.abort()
        expect(first.completed()).toBe(true)
        resolveFactory('late-win')
        await flushMicrotasks()
        expect(first.values).toEqual([])
        let rejectSecond!: (reason: unknown) => void
        const gateSecond = new Promise<string>((_resolve, reject) => {
            rejectSecond = reject
        })
        const secondMounted = await mount({
            singles: [{
                ...asyncReg('app:pending-miss', null),
                factory: () => gateSecond,
            }],
        })
        const secondController = new AbortController()
        const second = collect(api.inject$('app:pending-miss', { signal: secondController.signal })(secondMounted.native))
        secondController.abort()
        rejectSecond(new Error('late-failure'))
        await flushMicrotasks()
        expect(second.values).toEqual([])
        expect(second.errors).toEqual([])
        expect(second.completed()).toBe(true)
    })

    it('settles late on multi hit paths after an abort', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let resolveFactory!: (value: string) => void
        const gate = new Promise<string>((resolve) => {
            resolveFactory = resolve
        })
        const mounted = await mount({
            multis: [{
                ...asyncReg('app:pending-tags', null),
                multi: true,
                factory: () => gate,
            }],
        })
        const controller = new AbortController()
        const collected = collect(api.injectAll$('app:pending-tags', { signal: controller.signal })(mounted.native))
        controller.abort()
        expect(collected.completed()).toBe(true)
        resolveFactory('late-tag')
        await flushMicrotasks()
        expect(collected.values).toEqual([])
        let rejectSecond!: (reason: unknown) => void
        const gateSecond = new Promise<string>((_resolve, reject) => {
            rejectSecond = reject
        })
        const secondMounted = await mount({
            multis: [{
                ...asyncReg('app:pending-bad-tags', null),
                multi: true,
                factory: () => gateSecond,
            }],
        })
        const secondController = new AbortController()
        const second = collect(
            api.injectAll$('app:pending-bad-tags', { signal: secondController.signal })(secondMounted.native),
        )
        secondController.abort()
        rejectSecond(new Error('late-multi-failure'))
        await flushMicrotasks()
        expect(second.values).toEqual([])
        expect(second.errors).toEqual([])
        expect(second.completed()).toBe(true)
    })

    it('stops hit-path waits on immediate unsubscribe', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        const { native } = await mount({ singles: [syncReg('app:hit', 'hit')] })
        // Scoped hits settle on a microtask: unsubscribing synchronously tears
        // down before settlement, so nothing ever emits.
        const collected = collect(api.inject$('app:hit')(native))
        collected.unsubscribe()
        await flushMicrotasks()
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(false)
        const multi = await mount({ multis: [{ ...syncReg('app:tags', 't'), multi: true }] })
        const multiCollected = collect(api.injectAll$('app:tags')(multi.native))
        multiCollected.unsubscribe()
        await flushMicrotasks()
        expect(multiCollected.values).toEqual([])
        expect(multiCollected.completed()).toBe(false)
    })

    it('keeps a hijacked singleton slot instead of evicting on rejection', async () => {
        const { ctx, mount } = setup()
        const api = createInjection(ctx)
        let rejectFactory!: (reason: unknown) => void
        const gate = new Promise<string>((_resolve, reject) => {
            rejectFactory = reject
        })
        const { native } = await mount({
            singles: [{
                ...asyncReg('app:hijacked', null),
                lifecycle: 'singleton',
                factory: () => gate,
            }],
        })
        const pending = api.inject('app:hijacked')(native)
        const assertion = expect(pending).rejects.toThrow('slot-broken')
        ctx.singletons.set('app:hijacked', 'hijack-value')
        rejectFactory(new Error('slot-broken'))
        await assertion
        expect(ctx.singletons.get('app:hijacked')).toBe('hijack-value')
    })

    it('pends multi waits on explicit Session targets with abort support', async () => {
        const fns = setup()
        const api = createInjection(fns.ctx)
        const { facade, host } = await fns.mount()
        const collected = collect(api.injectAll$('app:tags')(facade))
        expect(collected.completed()).toBe(false)
        fns.world.provide('app:tags', 'session-tag', host)
        expect(collected.values).toEqual([['session-tag']])
        expect(collected.completed()).toBe(true)
    })
})
