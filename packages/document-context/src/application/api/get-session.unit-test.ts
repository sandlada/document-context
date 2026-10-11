import type { Observable } from 'rxjs'
import { EMPTY, Subject, throwError } from 'rxjs'
import { describe, expect, it } from 'vitest'
import { DocumentContextError, mountSession, resuscitateSession, suspendSession } from '../../domain/index.js'
import type {
    ContextBlueprint,
    HostPort,
    MountSessionRecord,
    Session,
} from '../../domain/index.js'
import { createFakeHost, createFakeScheduler } from '../../domain/testing/fakes.js'
import type { FakeHost, FakeScheduler } from '../../domain/testing/fakes.js'
import { createSessionTracking } from './get-session.js'
import type { SessionTrackingContext } from './get-session.js'

type AnySession = Session<Record<PropertyKey, unknown>, unknown>
type AnyRecord = MountSessionRecord<Record<PropertyKey, unknown>>

interface Mounted {
    readonly host: FakeHost
    readonly native: unknown
    readonly facade: AnySession
    readonly record: AnyRecord
}

interface Setup {
    readonly ctx: SessionTrackingContext
    readonly sessions: Map<unknown, { readonly facade: AnySession, readonly record: AnyRecord }>
    readonly scheduler: FakeScheduler
    readonly settled$: Subject<void>
    readonly probe: (parent?: HostPort<unknown> | null) => FakeHost
    readonly mount: (opts?: {
        readonly parent?: HostPort<unknown> | null
        readonly token?: string | null
        readonly initial?: Record<PropertyKey, unknown>
    }) => Promise<Mounted>
}

const setup = (): Setup => {
    const scheduler = createFakeScheduler()
    const natives = new Map<unknown, FakeHost>()
    const sessions = new Map<unknown, { readonly facade: AnySession, readonly record: AnyRecord }>()
    const settled$ = new Subject<void>()
    const ctx: SessionTrackingContext = {
        ports: {
            host: {
                toHost: (native: unknown): HostPort<unknown> => {
                    const found = natives.get(native)
                    if (found === undefined) {
                        throw new DocumentContextError('HOST_INVALID', { reason: 'unknown-native' })
                    }
                    return found
                },
            },
        },
        sessions,
        settled$,
    }
    const probe = (parent: HostPort<unknown> | null = null): FakeHost => {
        const host = createFakeHost({ connected: true, parent })
        natives.set(host.native(), host)
        return host
    }
    const mount = async (opts: {
        readonly parent?: HostPort<unknown> | null
        readonly token?: string | null
        readonly initial?: Record<PropertyKey, unknown>
    } = {}): Promise<Mounted> => {
        const host = createFakeHost({ connected: true, parent: opts.parent ?? null, token: opts.token ?? null })
        natives.set(host.native(), host)
        const blueprint: ContextBlueprint<Record<PropertyKey, unknown>> = {
            initial: { ...(opts.initial ?? { count: 0 }) },
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
        const record = mounted.record
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
        return { host, native: host.native(), facade, record }
    }
    return { ctx, sessions, scheduler, settled$, probe, mount }
}

describe('getSessionSync snapshot', () => {
    it('returns the nearest mounted session along the ancestor chain', async () => {
        const { ctx, probe, mount } = setup()
        const tracking = createSessionTracking(ctx)
        const root = await mount()
        const leafHost = probe(root.host)
        expect(tracking.getSessionSync(leafHost.native())).toBe(root.facade)
        expect(tracking.getSessionSync(root.native)).toBe(root.facade)
    })

    it('returns null when no ancestor holds a session', async () => {
        const { ctx, probe } = setup()
        const tracking = createSessionTracking(ctx)
        const orphan = probe()
        expect(tracking.getSessionSync(orphan.native())).toBeNull()
    })

    it('skips suspended and disposed sessions (only mounted counts)', async () => {
        const fns = setup()
        const tracking = createSessionTracking(fns.ctx)
        const root = await fns.mount()
        const keyed = await fns.mount({ parent: root.host, token: 'app:box' })
        const probeHost = fns.probe(keyed.host)
        expect(tracking.getSessionSync(probeHost.native())).toBe(keyed.facade)
        suspendSession(keyed.record, { scheduler: fns.scheduler, ttlMs: 1000 })
        fns.settled$.next()
        expect(tracking.getSessionSync(probeHost.native())).toBe(root.facade)
    })

    it('throws HOST_INVALID for unknown natives', async () => {
        const { ctx } = setup()
        const tracking = createSessionTracking(ctx)
        expect(() => tracking.getSessionSync({})).toThrowError(
            expect.objectContaining({ code: 'HOST_INVALID' }),
        )
    })
})

describe('session$ hot tracking', () => {
    it('emits the current session immediately on subscribe', async () => {
        const { ctx, mount } = setup()
        const tracking = createSessionTracking(ctx)
        const root = await mount()
        const values: Array<AnySession | null> = []
        const subscription = tracking.session$(root.native).subscribe((session) => {
            values.push(session)
        })
        expect(values).toEqual([root.facade])
        subscription.unsubscribe()
    })

    it('emits null immediately when nothing is mounted', async () => {
        const { ctx, probe } = setup()
        const tracking = createSessionTracking(ctx)
        const orphan = probe()
        const values: Array<AnySession | null> = []
        const subscription = tracking.session$(orphan.native()).subscribe((session) => {
            values.push(session)
        })
        expect(values).toEqual([null])
        subscription.unsubscribe()
    })

    it('re-emits on settled$ when a session appears later', async () => {
        const fns = setup()
        const tracking = createSessionTracking(fns.ctx)
        const pending = fns.probe()
        const values: Array<AnySession | null> = []
        const subscription = tracking.session$(pending.native()).subscribe((session) => {
            values.push(session)
        })
        expect(values).toEqual([null])
        const root = await fns.mount()
        pending.setParent(root.host)
        fns.settled$.next()
        expect(values).toEqual([null, root.facade])
        subscription.unsubscribe()
    })

    it('emits null while suspended and re-emits the identical object on resuscitation', async () => {
        const fns = setup()
        const tracking = createSessionTracking(fns.ctx)
        const keyed = await fns.mount({ token: 'app:box' })
        const values: Array<AnySession | null> = []
        const subscription = tracking.session$(keyed.native).subscribe((session) => {
            values.push(session)
        })
        expect(values).toEqual([keyed.facade])
        const handle = suspendSession(keyed.record, { scheduler: fns.scheduler, ttlMs: 1000 })
        fns.settled$.next()
        expect(values).toEqual([keyed.facade, null])
        const fresh = fns.probe()
        resuscitateSession(handle, fresh)
        fns.sessions.set(fresh.native(), { facade: keyed.facade, record: keyed.record })
        fns.settled$.next()
        expect(values).toEqual([keyed.facade, null, keyed.facade])
        expect(values[2]).toBe(keyed.facade)
        subscription.unsubscribe()
    })

    it('completes on signal abort, and immediately when pre-aborted', async () => {
        const { ctx, mount } = setup()
        const tracking = createSessionTracking(ctx)
        const root = await mount()
        const controller = new AbortController()
        let completed = false
        const subscription = tracking
            .session$(root.native, { signal: controller.signal })
            .subscribe({ complete: () => { completed = true } })
        controller.abort()
        expect(completed).toBe(true)
        subscription.unsubscribe()
        let preCompleted = false
        tracking
            .session$(root.native, { signal: AbortSignal.abort() })
            .subscribe({ complete: () => { preCompleted = true } })
        expect(preCompleted).toBe(true)
    })

    it('reacts to ancestor host lifecycle events', async () => {
        const { ctx, probe, mount } = setup()
        const tracking = createSessionTracking(ctx)
        const root = await mount()
        const child = probe(root.host)
        const values: Array<AnySession | null> = []
        const subscription = tracking.session$(child.native()).subscribe((session) => {
            values.push(session)
        })
        expect(values).toEqual([root.facade])
        root.host.setConnected(false)
        expect(values).toEqual([root.facade, null])
        subscription.unsubscribe()
    })

    it('degrades to settled$-only triggers when host resolution fails mid-subscribe', async () => {
        const natives = new Map<unknown, FakeHost>()
        const sessions = new Map<unknown, { readonly facade: AnySession, readonly record: AnyRecord }>()
        const settled$ = new Subject<void>()
        const inner = setup()
        const root = await inner.mount()
        natives.set(root.native, root.host)
        sessions.set(root.native, { facade: root.facade, record: root.record })
        let calls = 0
        const ctx: SessionTrackingContext = {
            ports: {
                host: {
                    toHost: (native: unknown): HostPort<unknown> => {
                        calls += 1
                        if (calls > 1) {
                            throw new DocumentContextError('HOST_INVALID', { reason: 'flaky-adapter' })
                        }
                        const found = natives.get(native)
                        if (found === undefined) {
                            throw new DocumentContextError('HOST_INVALID', { reason: 'unknown-native' })
                        }
                        return found
                    },
                },
            },
            sessions,
            settled$,
        }
        const tracking = createSessionTracking(ctx)
        const values: Array<AnySession | null> = []
        const subscription = tracking.session$(root.native).subscribe((session) => {
            values.push(session)
        })
        expect(values).toEqual([root.facade])
        settled$.next()
        expect(values).toEqual([root.facade])
        subscription.unsubscribe()
    })

    it('errors HOST_INVALID on session$ for unknown natives', async () => {
        const { ctx } = setup()
        const tracking = createSessionTracking(ctx)
        const errors: Array<unknown> = []
        tracking.session$({} as unknown as never).subscribe({
            error: (error: unknown) => {
                errors.push(error)
            },
        })
        expect(errors).toHaveLength(1)
        expect((errors[0] as DocumentContextError).code).toBe('HOST_INVALID')
    })

    it('ignores identity-preserving resettlements', async () => {
        const { ctx, mount, settled$ } = setup()
        const tracking = createSessionTracking(ctx)
        const root = await mount()
        const values: Array<AnySession | null> = []
        const subscription = tracking.session$(root.native).subscribe((session) => {
            values.push(session)
        })
        expect(values).toEqual([root.facade])
        settled$.next()
        settled$.next()
        expect(values).toEqual([root.facade])
        subscription.unsubscribe()
    })

    it('survives mid-stream snapshot failures without emitting', async () => {
        const fns = setup()
        const tracking = createSessionTracking(fns.ctx)
        const root = await fns.mount()
        const values: Array<AnySession | null> = []
        const subscription = tracking.session$(root.native).subscribe((session) => {
            values.push(session)
        })
        expect(values).toEqual([root.facade])
        const host = root.host as FakeHost
        const native = host.native.bind(host)
        let flipping = false
        host.native = (): unknown => {
            if (flipping) {
                throw new Error('native-gone')
            }
            return native()
        }
        flipping = true
        fns.settled$.next()
        expect(values).toEqual([root.facade])
        flipping = false
        subscription.unsubscribe()
    })

    it('forwards trigger errors to the subscriber', async () => {
        const natives = new Map<unknown, FakeHost>()
        const sessions = new Map<unknown, { readonly facade: AnySession, readonly record: AnyRecord }>()
        const settled$ = new Subject<void>()
        const scheduler = createFakeScheduler()
        const blueprint: ContextBlueprint<Record<PropertyKey, unknown>> = {
            initial: {},
            providers: new Map(),
            hooks: [],
            storage: null,
        }
        const host = createFakeHost({ connected: true })
        natives.set(host.native(), host)
        const mounted = mountSession({
            blueprint,
            host,
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
        })
        await mounted.ready
        const record = mounted.record
        const facade = {
            get host(): HostPort<unknown> {
                return record.host as HostPort<unknown>
            },
            token: null,
            get isConnected(): boolean {
                return true
            },
            get isSuspended(): boolean {
                return false
            },
            get isDisposed(): boolean {
                return false
            },
            abortSignal: record.abortController.signal,
            state$: record.sessionState.state$,
            errors$: EMPTY as unknown as Observable<DocumentContextError>,
            lifecycle$: EMPTY as unknown as Observable<never>,
            abort$: record.abort$,
        } as unknown as AnySession
        sessions.set(host.native(), { facade, record })
        const failing = createFakeHost({ connected: true })
        const erroringHost = {
            ...failing,
            lifecycle$: throwError(() => new Error('trigger-broken')),
        } as unknown as FakeHost
        natives.set(erroringHost.native(), erroringHost)
        const ctx: SessionTrackingContext = {
            ports: {
                host: {
                    toHost: (native: unknown): HostPort<unknown> => {
                        const found = natives.get(native)
                        if (found === undefined) {
                            throw new DocumentContextError('HOST_INVALID', { reason: 'unknown-native' })
                        }
                        return found
                    },
                },
            },
            sessions,
            settled$,
        }
        const tracking = createSessionTracking(ctx)
        const errors: Array<unknown> = []
        const subscription = tracking.session$(erroringHost.native()).subscribe({
            error: (error: unknown) => {
                errors.push(error)
            },
        })
        expect(errors).toHaveLength(1)
        expect((errors[0] as Error).message).toBe('trigger-broken')
        subscription.unsubscribe()
    })
})
