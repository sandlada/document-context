/**
 * SSR nullHost regression tests: server-side mounts over the connectionless
 * null host (07 §7.2 / §7.7, D-49, D-92).
 *
 * Runs in the `application` project (plain node): no DOM globals, no
 * `infra/dom` imports. The real infrastructure null host is imported
 * directly (TEST-ONLY cross-layer import) so the production guards
 * (`keyOf` fallback, token-write skips, disposal guards) are proven against
 * the host they will meet in production, whose `native()` throws
 * `HOST_INVALID`.
 */
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
} from '../../domain/testing/fakes.js'
import type { FakeScheduler } from '../../domain/testing/fakes.js'
import { createNullHost } from '../../infrastructure/ssr/null-host.js'
import { serialize as ssrSerialize } from '../../infrastructure/ssr/serialize.js'
import { createDispose } from './dispose.js'
import { createMount, createMountSync } from './mount.js'
import { createSelection } from './select.js'
import { createUpdate } from './update.js'
import type { ApplicationContext } from '../context.js'

interface TestWorld {
    readonly ctx: ApplicationContext
    readonly scheduler: FakeScheduler
    readonly nullHost: HostPort
    readonly writeSpy: ReturnType<typeof vi.fn>
}

const createWorld = (payload: Record<string, unknown> | null = null): TestWorld => {
    const scheduler = createFakeScheduler()
    const world = createFakeScopeTransport()
    const nullHost = createNullHost()
    const writeSpy = vi.fn((_native: unknown, _token: string | null): void => undefined)
    const ctx: ApplicationContext = {
        ports: {
            host: {
                toHost: (node: unknown): HostPort => {
                    if (node === nullHost) {
                        throw new DocumentContextError('HOST_INVALID', { reason: 'nullHost is not a DOM node' })
                    }
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
                    read: (): null => null,
                    write: (native: unknown, token: string | null): void => {
                        writeSpy(native, token)
                    },
                },
            },
            storage: {
                resolve: (): StoragePort | null => null,
            },
            ssr: {
                nullHost,
                payloadResolver: (): unknown | null => payload,
                serialize: ssrSerialize,
            },
        },
        sessions: new Map<object, { facade: Session, record: MountSessionRecord<Record<PropertyKey, unknown>> }>(),
        keyed: new Map<string, Session>(),
        records: new WeakMap<object, MountSessionRecord<Record<PropertyKey, unknown>>>(),
        singletons: new Map<string, { status: 'resolved', value: unknown } | { status: 'inflight', promise: Promise<unknown> }>(),
        settled$: new Subject<void>(),
    }
    return { ctx, scheduler, nullHost, writeSpy }
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

const snapshotOf = <S extends Record<PropertyKey, unknown>>(session: Session<S, unknown>): S => {
    let current!: S
    session.state$.subscribe((state) => {
        current = state
    }).unsubscribe()
    return current
}

describe('ssr nullHost anonymous mount', () => {
    it('mount resolves without HOST_INVALID or UNCONNECTED_NODE', async () => {
        const { ctx, nullHost } = createWorld()
        const session = await createMount(ctx)(blueprintOf({ count: 0 }))(nullHost)
        expect(session.token).toBeNull()
        expect(session.isConnected).toBe(true)
        expect(session.isSuspended).toBe(false)
        expect(session.isDisposed).toBe(false)
        expect(snapshotOf(session)).toEqual({ count: 0 })
    })

    it('mountSync resolves on the nullHost without throwing', () => {
        const { ctx, nullHost } = createWorld()
        const session = createMountSync(ctx)(blueprintOf({ count: 4 }))(nullHost)
        expect(session.token).toBeNull()
        expect(snapshotOf(session)).toEqual({ count: 4 })
    })

    it('never attempts a token-attribute write, even when keyed', async () => {
        const { ctx, nullHost, writeSpy } = createWorld()
        const anonymous = await createMount(ctx)(blueprintOf({ count: 0 }))(nullHost)
        expect(writeSpy).not.toHaveBeenCalled()
        createDispose(ctx)(anonymous)
        expect(writeSpy).not.toHaveBeenCalled()
    })

    it('supports the update/select round-trip', async () => {
        const { ctx, nullHost } = createWorld()
        const session = await createMount(ctx)(blueprintOf({ count: 0 }))(nullHost)
        const update = createUpdate(ctx)
        const { selectSync } = createSelection(ctx)
        expect(update({ count: 41 })(session as Session<{ count: number }, unknown>)).toBe(true)
        expect(selectSync((state: { count: number }) => state.count)(session as Session<{ count: number }, unknown>)).toBe(41)
        expect(snapshotOf(session)).toEqual({ count: 41 })
    })

    it('disposes cleanly without touching token storage', async () => {
        const { ctx, nullHost, writeSpy } = createWorld()
        const session = await createMount(ctx)(blueprintOf({ count: 0 }))(nullHost)
        const events: Array<string> = []
        session.lifecycle$.subscribe((event) => {
            events.push(event.type)
        })
        createDispose(ctx)(session)
        expect(session.isDisposed).toBe(true)
        expect(events).toEqual(['disposed'])
        expect(writeSpy).not.toHaveBeenCalled()
    })

    it('serializes the session through the ssr adapter payload path', async () => {
        const { ctx, nullHost } = createWorld()
        const session = await createMount(ctx)(blueprintOf({ count: 3 }))(nullHost)
        const serialize = ctx.ports.ssr?.serialize
        expect(serialize).toBe(ssrSerialize)
        expect(serialize?.()(session as Session<{ count: number }>)).toBe('{"count":3}')
    })
})

describe('ssr nullHost keyed mount', () => {
    it('mounts keyed via options.token with no adapter read and no write-back', async () => {
        const { ctx, nullHost, writeSpy } = createWorld()
        const session = await createMount(ctx)(blueprintOf({ count: 1 }), { token: 'app:box' })(nullHost)
        expect(session.token).toBe('app:box')
        expect(snapshotOf(session)).toEqual({ count: 1 })
        expect(writeSpy).not.toHaveBeenCalled()
    })

    it('mountSync mounts keyed via options.token with no write-back', () => {
        const { ctx, nullHost, writeSpy } = createWorld()
        const session = createMountSync(ctx)(blueprintOf({ count: 2 }), { token: 'app:sync-box' })(nullHost)
        expect(session.token).toBe('app:sync-box')
        expect(writeSpy).not.toHaveBeenCalled()
    })

    it('is idempotent on repeat keyed mounts (first blueprint wins)', async () => {
        const { ctx, nullHost, writeSpy } = createWorld()
        const first = await createMount(ctx)(blueprintOf({ count: 1 }), { token: 'app:repeat' })(nullHost)
        const second = await createMount(ctx)(blueprintOf({ count: 2 }), { token: 'app:repeat' })(nullHost)
        expect(second).toBe(first)
        expect(snapshotOf(first)).toEqual({ count: 1 })
        expect(writeSpy).not.toHaveBeenCalled()
    })

    it('never suspends: the nullHost stays connected across scheduler drains', async () => {
        const { ctx, nullHost, scheduler, writeSpy } = createWorld()
        const session = await createMount(ctx)(blueprintOf({ count: 5 }), { token: 'app:pinned' })(nullHost)
        const events: Array<string> = []
        session.lifecycle$.subscribe((event) => {
            events.push(event.type)
        })
        scheduler.flushMicrotasks()
        scheduler.flushTimeouts()
        scheduler.flushAll()
        expect(session.isSuspended).toBe(false)
        expect(session.isDisposed).toBe(false)
        expect(session.isConnected).toBe(true)
        expect(events).toEqual([])
        expect(writeSpy).not.toHaveBeenCalled()
    })

    it('hydrates the ssr payload for keyed sessions', async () => {
        const { ctx, nullHost } = createWorld({ count: 9 })
        const session = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:hydrated' })(nullHost)
        expect(snapshotOf(session)).toEqual({ count: 9 })
    })

    it('disposes a keyed session without token write-back', async () => {
        const { ctx, nullHost, writeSpy } = createWorld()
        const session = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:bye' })(nullHost)
        createDispose(ctx)(session)
        expect(session.isDisposed).toBe(true)
        expect(ctx.keyed.get('app:bye')).toBeUndefined()
        expect(writeSpy).not.toHaveBeenCalled()
    })
})

describe('ssr skips onMount (D-49)', () => {
    it('async mount never runs onMount hooks on the nullHost', async () => {
        const { ctx, nullHost } = createWorld()
        let calls = 0
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', () => {
                calls += 1
            }),
        ])
        const session = await createMount(ctx)(bp)(nullHost)
        expect(calls).toBe(0)
        expect(session.isDisposed).toBe(false)
        expect(snapshotOf(session)).toEqual({ count: 0 })
    })

    it('sync mount never runs onMount hooks on the nullHost', () => {
        const { ctx, nullHost } = createWorld()
        let calls = 0
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', () => {
                calls += 1
            }),
        ])
        const session = createMountSync(ctx)(bp)(nullHost)
        expect(calls).toBe(0)
        expect(session.isDisposed).toBe(false)
    })

    it('still runs onMount for DOM mounts (control)', async () => {
        const { ctx } = createWorld()
        const host = createFakeHost({ connected: true })
        let calls = 0
        const bp = blueprintOf({ count: 0 }, [], [
            hook('mount', () => {
                calls += 1
            }),
        ])
        await createMount(ctx)(bp)(host)
        expect(calls).toBe(1)
    })

    it('still runs onDispose on the server when the session is disposed', async () => {
        const { ctx, nullHost } = createWorld()
        const cleaned: Array<string> = []
        const bp = blueprintOf({ count: 0 }, [], [
            hook('dispose', () => {
                cleaned.push('disposed')
            }),
        ])
        const session = await createMount(ctx)(bp)(nullHost)
        createDispose(ctx)(session)
        expect(cleaned).toEqual(['disposed'])
    })

    it('still warms eager providers on the server (data loading contract)', async () => {
        const { ctx, nullHost } = createWorld()
        let warmed = ''
        const bp = blueprintOf({ count: 0 }, [
            {
                token: 'app:data',
                factory: () => {
                    warmed = 'warmed'
                    return { rows: [1, 2, 3] }
                },
                lifecycle: 'scoped',
                async: false,
                multi: false,
                eager: true,
            },
        ])
        const session = await createMount(ctx)(bp)(nullHost)
        expect(warmed).toBe('warmed')
        expect(session.isDisposed).toBe(false)
    })

    it('resuscitating a suspended session onto the nullHost keeps state without onMount', async () => {
        const { ctx, nullHost, scheduler } = createWorld()
        const host = createFakeHost({ connected: true })
        let calls = 0
        const bp = blueprintOf({ count: 6 }, [], [
            hook('mount', () => {
                calls += 1
            }),
        ])
        const session = await createMount(ctx)(bp, { token: 'app:roam' })(host)
        expect(calls).toBe(1)
        host.setConnected(false)
        scheduler.flushMicrotasks()
        expect(session.isSuspended).toBe(true)
        const revived = await createMount(ctx)(bp, { token: 'app:roam' })(nullHost)
        expect(revived).toBe(session)
        expect(calls).toBe(1)
        expect(snapshotOf(revived)).toEqual({ count: 6 })
    })

    it('resuscitating a parked session onto the nullHost defers onMount', async () => {
        const { ctx, nullHost } = createWorld()
        const host = createFakeHost({ connected: true })
        let calls = 0
        const bp = blueprintOf({ count: 6 }, [], [
            hook('mount', () => {
                calls += 1
            }),
        ])
        const pending = createMount(ctx)(bp, { token: 'app:parked-roam' })(host)
        host.setConnected(false)
        const parked = await pending
        expect(parked.isSuspended).toBe(true)
        expect(calls).toBe(0)
        const revived = await createMount(ctx)(bp, { token: 'app:parked-roam' })(nullHost)
        expect(revived).toBe(parked)
        expect(calls).toBe(0)
        expect(snapshotOf(revived)).toEqual({ count: 6 })
        expect(revived.isSuspended).toBe(false)
    })
})

describe('ssr nullHost guard details', () => {
    it('keyOf falls back to the host when native() throws (shared session map key)', async () => {
        const { ctx, nullHost } = createWorld()
        expect(() => nullHost.native()).toThrowError(DocumentContextError)
        const first = await createMount(ctx)(blueprintOf({ count: 0 }))(nullHost)
        const second = await createMount(ctx)(blueprintOf({ count: 0 }))(nullHost)
        expect(second).toBe(first)
    })

    it('rejects TOKEN_INVALID for malformed keyed identities on the nullHost', async () => {
        const { ctx, nullHost } = createWorld()
        const error = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'no-namespace' })(nullHost).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('TOKEN_INVALID')
    })

    it('still enforces genuine dual-active keyed conflicts across hosts', async () => {
        const { ctx, nullHost } = createWorld()
        const host = createFakeHost({ connected: true })
        await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:live' })(host)
        const error = await createMount(ctx)(blueprintOf({ count: 0 }), { token: 'app:live' })(nullHost).then(
            () => null,
            (reason: unknown) => reason,
        )
        expect(error).toBeInstanceOf(DocumentContextError)
        expect((error as DocumentContextError).code).toBe('KEYED_SESSION_CONFLICT')
    })
})
