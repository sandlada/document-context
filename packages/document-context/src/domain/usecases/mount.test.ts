import { describe, expect, it } from 'vitest'
import { DocumentContextError } from '../model/errors.js'
import type { ContextBlueprint } from '../model/blueprint.js'
import type { ServiceRegistration } from '../model/service.js'
import { createFakeHost, createFakeScheduler } from '../testing/fakes.js'
import { mountSession } from './mount.js'

type State = {
    count: number
}

const seed = (): State => ({ count: 0 })

const blueprintWith = (
    providers: ReadonlyArray<ServiceRegistration> = [],
): ContextBlueprint<State> => ({
    initial: seed(),
    providers: new Map(providers.map((reg) => [reg.token as string, reg])),
    hooks: [],
    storage: null,
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

describe('mountSession construction', () => {
    it('creates an initializing record with a seed copy, services, abort wiring, and createdAt', () => {
        const scheduler = createFakeScheduler()
        const host = createFakeHost({ connected: true })
        const { record, ready } = mountSession({
            blueprint: blueprintWith(),
            host,
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
            now: () => 123,
        })
        expect(record.status).toBe('initializing')
        expect(record.kind).toBe('anonymous')
        expect(record.token).toBeNull()
        expect(record.host).toBe(host)
        expect(record.sessionState.getSnapshot()).toEqual(seed())
        expect(record.sessionState.getSnapshot()).not.toBe(seed())
        expect(record.services.size()).toBe(0)
        expect(record.abortController.signal.aborted).toBe(false)
        expect(record.onMountSkipped).toBe(false)
        expect(record.createdAt).toBe(123)
        expect(record.scheduler).toBe(scheduler)
        void ready
    })

    it('registers blueprint providers without executing factories', () => {
        const scheduler = createFakeScheduler()
        let calls = 0
        const reg: ServiceRegistration = {
            token: 'app:lazy',
            factory: () => {
                calls += 1
                return 'lazy-value'
            },
            lifecycle: 'scoped',
            async: false,
            multi: false,
            eager: false,
        }
        const { record } = mountSession({
            blueprint: blueprintWith([reg]),
            host: createFakeHost({ connected: true }),
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
        })
        expect(record.services.size()).toBe(1)
        expect(calls).toBe(0)
    })

    it('exposes initializing status for the mountSync window (application throws ASYNC_SERVICE_NOT_READY)', () => {
        const gate = deferred<string>()
        const scheduler = createFakeScheduler()
        const { record, ready } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:eager',
                factory: () => gate.promise,
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            }]),
            host: createFakeHost({ connected: true }),
            kind: 'keyed',
            token: 'app:box',
            ports: { scheduler },
        })
        expect(record.status).toBe('initializing')
        gate.resolve('done')
        return expect(ready).resolves.toBeUndefined().then(() => {
            expect(record.status).toBe('mounted')
        })
    })
})

describe('mountSession eager and ready', () => {
    it('instantiates eager services with the record session and resolves mounted', async () => {
        const scheduler = createFakeScheduler()
        let seen: unknown = null
        let calls = 0
        const { record, ready } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:eager',
                factory: (session: unknown) => {
                    calls += 1
                    seen = session
                    return 'eager-value'
                },
                lifecycle: 'scoped',
                async: false,
                multi: false,
                eager: true,
            }]),
            host: createFakeHost({ connected: true }),
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
        })
        await expect(ready).resolves.toBeUndefined()
        expect(record.status).toBe('mounted')
        expect(calls).toBe(1)
        expect(seen).toBe(record)
    })

    it('resolves mounted immediately when no eager services exist', async () => {
        const scheduler = createFakeScheduler()
        const { record, ready } = mountSession({
            blueprint: blueprintWith(),
            host: createFakeHost({ connected: true }),
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
        })
        await expect(ready).resolves.toBeUndefined()
        expect(record.status).toBe('mounted')
    })

    it('rejects ready with the bare reason on eager failure (no wrapping, application routes)', async () => {
        const scheduler = createFakeScheduler()
        const cause = new Error('eager-boom')
        const { record, ready } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:bad',
                factory: () => Promise.reject(cause),
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            }]),
            host: createFakeHost({ connected: true }),
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
        })
        await expect(ready).rejects.toBe(cause)
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
        expect(record.abortController.signal.aborted).toBe(true)
    })
})

describe('mountSession waiting-disconnect (D-82)', () => {
    it('parks keyed sessions in suspended with onMountSkipped and resolves ready', async () => {
        const gate = deferred<string>()
        const scheduler = createFakeScheduler()
        const host = createFakeHost({ connected: true })
        const { record, ready, notifyDisconnectedDuringInit } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:eager',
                factory: () => gate.promise,
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            }]),
            host,
            kind: 'keyed',
            token: 'app:box',
            ports: { scheduler },
        })
        host.setConnected(false)
        notifyDisconnectedDuringInit()
        expect(record.status).toBe('suspended')
        expect(record.onMountSkipped).toBe(true)
        await expect(ready).resolves.toBeUndefined()
        expect(record.sessionState.isPoisoned()).toBe(false)
        expect(record.abortController.signal.aborted).toBe(false)
        gate.resolve('late-eager')
        await Promise.resolve()
        expect(record.status).toBe('suspended')
    })

    it('disposes anonymous sessions on waiting-disconnect and rejects UNCONNECTED_NODE', async () => {
        const gate = deferred<string>()
        const scheduler = createFakeScheduler()
        const host = createFakeHost({ connected: true })
        const { record, ready, notifyDisconnectedDuringInit } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:eager',
                factory: () => gate.promise,
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            }]),
            host,
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
        })
        host.setConnected(false)
        notifyDisconnectedDuringInit()
        expect(record.status).toBe('disposed')
        await expect(ready).rejects.toMatchObject({ code: 'UNCONNECTED_NODE' })
        expect(record.sessionState.isPoisoned()).toBe(true)
    })

    it('ignores duplicate waiting-disconnect notifications (idempotent)', async () => {
        const scheduler = createFakeScheduler()
        const host = createFakeHost({ connected: true })
        const { record, ready, notifyDisconnectedDuringInit } = mountSession({
            blueprint: blueprintWith(),
            host,
            kind: 'keyed',
            token: 'app:box',
            ports: { scheduler },
        })
        host.setConnected(false)
        notifyDisconnectedDuringInit()
        notifyDisconnectedDuringInit()
        expect(record.status).toBe('suspended')
        await expect(ready).resolves.toBeUndefined()
    })
})

describe('mountSession abort and dispose during init', () => {
    it('aborts with signal.reason and discards eager results (abort wins same-task)', async () => {
        const gate = deferred<string>()
        const scheduler = createFakeScheduler()
        const { record, ready, abort } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:eager',
                factory: () => gate.promise,
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            }]),
            host: createFakeHost({ connected: true }),
            kind: 'keyed',
            token: 'app:box',
            ports: { scheduler },
        })
        const reason = new Error('user-abort')
        abort(reason)
        expect(record.status).toBe('disposed')
        gate.resolve('too-late')
        await expect(ready).rejects.toBe(reason)
        expect(record.sessionState.isPoisoned()).toBe(true)
    })

    it('aborts with the platform AbortError when no reason is given', async () => {
        const gate = deferred<string>()
        const scheduler = createFakeScheduler()
        const { ready, abort } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:eager',
                factory: () => gate.promise,
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            }]),
            host: createFakeHost({ connected: true }),
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
        })
        abort()
        gate.resolve('too-late')
        try {
            await ready
            throw new Error('expected abort rejection')
        } catch (error) {
            expect(error).toBeInstanceOf(Error)
        }
    })

    it('rejects explicit dispose during init with DISPOSED_SESSION', async () => {
        const gate = deferred<string>()
        const scheduler = createFakeScheduler()
        const { record, ready, dispose } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:eager',
                factory: () => gate.promise,
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            }]),
            host: createFakeHost({ connected: true }),
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
        })
        dispose()
        expect(record.status).toBe('disposed')
        gate.resolve('too-late')
        try {
            await ready
            throw new Error('expected DISPOSED_SESSION')
        } catch (error) {
            expect(error).toBeInstanceOf(DocumentContextError)
            expect((error as DocumentContextError).code).toBe('DISPOSED_SESSION')
        }
    })
})

describe('mountSession abort and dispose edge paths (D-104)', () => {
    const tick = async (rounds = 12): Promise<void> => {
        for (let i = 0; i < rounds; i += 1) {
            await Promise.resolve()
        }
    }

    it('rejects with signal.reason when the raw controller aborts before a no-eager flush (abort-check precedes delivery)', async () => {
        const scheduler = createFakeScheduler()
        const { record, ready } = mountSession({
            blueprint: blueprintWith(),
            host: createFakeHost({ connected: true }),
            kind: 'keyed',
            token: 'app:box',
            ports: { scheduler },
        })
        const reason = new Error('raw-abort')
        record.abortController.abort(reason)
        await expect(ready).rejects.toBe(reason)
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
        expect(record.onMountSkipped).toBe(false)
    })

    it('discards a successful eager settlement after a raw-controller abort (abort wins)', async () => {
        const gate = deferred<string>()
        const scheduler = createFakeScheduler()
        const { record, ready } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:eager',
                factory: () => gate.promise,
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            }]),
            host: createFakeHost({ connected: true }),
            kind: 'keyed',
            token: 'app:box',
            ports: { scheduler },
        })
        const reason = new Error('raw-abort-eager')
        record.abortController.abort(reason)
        gate.resolve('too-late')
        await tick()
        await expect(ready).rejects.toBe(reason)
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
    })

    it('ignores a late eager rejection after abort (single settlement, abort reason stands)', async () => {
        const gate = deferred<string>()
        const scheduler = createFakeScheduler()
        const { record, ready, abort } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:eager',
                factory: () => gate.promise,
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            }]),
            host: createFakeHost({ connected: true }),
            kind: 'keyed',
            token: 'app:box',
            ports: { scheduler },
        })
        const reason = new Error('user-abort')
        abort(reason)
        gate.reject(new Error('late-eager-boom'))
        await tick()
        await expect(ready).rejects.toBe(reason)
        expect(record.status).toBe('disposed')
    })

    it('ignores a late eager rejection after keyed waiting-disconnect (ready stays resolved)', async () => {
        const gate = deferred<string>()
        const scheduler = createFakeScheduler()
        const host = createFakeHost({ connected: true })
        const { record, ready, notifyDisconnectedDuringInit } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:eager',
                factory: () => gate.promise,
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            }]),
            host,
            kind: 'keyed',
            token: 'app:box',
            ports: { scheduler },
        })
        host.setConnected(false)
        notifyDisconnectedDuringInit()
        await expect(ready).resolves.toBeUndefined()
        gate.reject(new Error('late-eager-boom'))
        await tick()
        expect(record.status).toBe('suspended')
        expect(record.onMountSkipped).toBe(true)
        expect(record.sessionState.isPoisoned()).toBe(false)
    })

    it('makes a second abort after disposal a no-op (idempotent)', async () => {
        const gate = deferred<string>()
        const scheduler = createFakeScheduler()
        const { record, ready, abort } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:eager',
                factory: () => gate.promise,
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            }]),
            host: createFakeHost({ connected: true }),
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
        })
        const reason = new Error('first-abort')
        abort(reason)
        abort(new Error('second-abort'))
        gate.resolve('too-late')
        await expect(ready).rejects.toBe(reason)
        expect(record.status).toBe('disposed')
    })

    it('makes dispose after abort a no-op (idempotent)', async () => {
        const gate = deferred<string>()
        const scheduler = createFakeScheduler()
        const { record, ready, abort, dispose } = mountSession({
            blueprint: blueprintWith([{
                token: 'app:eager',
                factory: () => gate.promise,
                lifecycle: 'scoped',
                async: true,
                multi: false,
                eager: true,
            }]),
            host: createFakeHost({ connected: true }),
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
        })
        const reason = new Error('user-abort')
        abort(reason)
        dispose()
        gate.resolve('too-late')
        await expect(ready).rejects.toBe(reason)
        expect(record.status).toBe('disposed')
    })

    it('aborts a mounted session through the post-init path', async () => {
        const scheduler = createFakeScheduler()
        const { record, ready, abort } = mountSession({
            blueprint: blueprintWith(),
            host: createFakeHost({ connected: true }),
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
        })
        await expect(ready).resolves.toBeUndefined()
        expect(record.status).toBe('mounted')
        abort(new Error('late-abort'))
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
        expect(record.abortController.signal.aborted).toBe(true)
    })

    it('aborts a suspended session through the post-init path', async () => {
        const scheduler = createFakeScheduler()
        const host = createFakeHost({ connected: true })
        const { record, ready, notifyDisconnectedDuringInit, abort } = mountSession({
            blueprint: blueprintWith(),
            host,
            kind: 'keyed',
            token: 'app:box',
            ports: { scheduler },
        })
        host.setConnected(false)
        notifyDisconnectedDuringInit()
        await expect(ready).resolves.toBeUndefined()
        expect(record.status).toBe('suspended')
        abort(new Error('suspended-abort'))
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
    })

    it('disposes a mounted session through the post-init path', async () => {
        const scheduler = createFakeScheduler()
        const { record, ready, dispose } = mountSession({
            blueprint: blueprintWith(),
            host: createFakeHost({ connected: true }),
            kind: 'anonymous',
            token: null,
            ports: { scheduler },
        })
        await expect(ready).resolves.toBeUndefined()
        dispose()
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
        dispose()
        expect(record.status).toBe('disposed')
    })

    it('disposes a suspended session through the post-init path', async () => {
        const scheduler = createFakeScheduler()
        const host = createFakeHost({ connected: true })
        const { record, ready, notifyDisconnectedDuringInit, dispose } = mountSession({
            blueprint: blueprintWith(),
            host,
            kind: 'keyed',
            token: 'app:box',
            ports: { scheduler },
        })
        host.setConnected(false)
        notifyDisconnectedDuringInit()
        await expect(ready).resolves.toBeUndefined()
        dispose()
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
    })
})
