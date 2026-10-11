import { describe, expect, it } from 'vitest'
import { Observable, Subject } from 'rxjs'
import { DocumentContextError } from '../model/errors.js'
import type { Token } from '../model/token.js'
import type { HostPort } from '../ports/host.js'
import type { ScopeResolution, ScopeTransportPort } from '../ports/scope-transport.js'
import { createFakeScopeTransport, createFakeScheduler } from '../testing/fakes.js'
import type { SchedulerPort } from '../ports/scheduler.js'
import { watchOnce } from './resolve-async.js'

const resolution = <T>(value: T): ScopeResolution<T> => ({
    value,
    unsubscribe: () => {},
})

const stubTransport = (shape: {
    readonly watch?: (subscriber: {
        readonly next: (value: ScopeResolution<unknown>) => void,
        readonly error: (error: unknown) => void,
        readonly complete: () => void,
    }) => void,
    readonly watchAll?: (subscriber: {
        readonly next: (value: ReadonlyArray<ScopeResolution<unknown>>) => void,
        readonly error: (error: unknown) => void,
        readonly complete: () => void,
    }) => void,
}): ScopeTransportPort => ({
    request: () => null,
    requestAll: () => [],
    watch: <T>(token: Token, from: HostPort) => new Observable<ScopeResolution<T>>((subscriber) => {
        void token
        void from
        shape.watch?.({
            next: (value) => {
                subscriber.next(value as ScopeResolution<T>)
            },
            error: (error: unknown) => {
                subscriber.error(error)
            },
            complete: () => {
                subscriber.complete()
            },
        })
    }),
    watchAll: <T>(token: Token, from: HostPort) => new Observable<ReadonlyArray<ScopeResolution<T>>>((subscriber) => {
        void token
        void from
        shape.watchAll?.({
            next: (value) => {
                subscriber.next(value as ReadonlyArray<ScopeResolution<T>>)
            },
            error: (error: unknown) => {
                subscriber.error(error)
            },
            complete: () => {
                subscriber.complete()
            },
        })
    }),
})

const manualScheduler = (): { readonly port: SchedulerPort, readonly tasks: Array<() => void> } => {
    const tasks: Array<() => void> = []
    return {
        port: {
            microtask: () => {},
            timeout: (task: () => void) => {
                tasks.push(task)
                return () => {}
            },
            frame: () => () => {},
        },
        tasks,
    }
}

const collect = <T>(observable: Observable<T>): {
    readonly values: Array<T>,
    readonly errors: Array<unknown>,
    readonly completed: () => boolean,
    readonly unsubscribe: () => void,
} => {
    const values: Array<T> = []
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
        unsubscribe: () => {
            subscription.unsubscribe()
        },
    }
}

describe('watchOnce single (cold resolve-once)', () => {
    it('stays cold until subscribe and settles on first emit', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const stream = watchOnce({ transport: world.transport, scheduler, token: 'app:late', from: leaf, multi: false })
        expect(world.pendingCount()).toBe(0)
        world.provide('app:late', 'early', leaf)
        const collected = collect(stream)
        expect(collected.values).toHaveLength(1)
        expect(collected.completed()).toBe(true)
    })

    it('pends while absent and wakes on provide (order-independent)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const collected = collect(watchOnce({ transport: world.transport, scheduler, token: 'app:late', from: leaf, multi: false }))
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(false)
        world.provide('app:late', 'woken', leaf)
        expect(collected.values).toHaveLength(1)
        expect(collected.completed()).toBe(true)
    })

    it('completes on abort without emitting (Observable abort is complete)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const controller = new AbortController()
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler,
            token: 'app:x',
            from: leaf,
            multi: false,
            signal: controller.signal,
        }))
        controller.abort()
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(true)
        expect(scheduler.pendingTimeouts()).toBe(0)
        world.provide('app:x', 'too-late', leaf)
        expect(collected.values).toEqual([])
    })

    it('completes immediately when the signal is already aborted', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler,
            token: 'app:x',
            from: leaf,
            multi: false,
            signal: AbortSignal.abort(),
        }))
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(true)
        expect(world.pendingCount()).toBe(0)
    })

    it('errors with RESOLUTION_TIMEOUT when scheduler.timeout fires first', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler,
            token: 'app:missing',
            from: leaf,
            multi: false,
            timeoutMs: 10,
        }))
        expect(scheduler.pendingTimeouts()).toBe(1)
        scheduler.flushTimeouts()
        expect(collected.values).toEqual([])
        expect(collected.errors).toHaveLength(1)
        expect(collected.errors[0]).toBeInstanceOf(DocumentContextError)
        expect((collected.errors[0] as DocumentContextError).code).toBe('RESOLUTION_TIMEOUT')
        expect((collected.errors[0] as DocumentContextError).details).toEqual({ token: 'app:missing', timeoutMs: 10 })
        expect(world.pendingCount()).toBe(0)
    })

    it('lets a hit win over a later timeout (first-wins, single settlement)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler,
            token: 'app:race',
            from: leaf,
            multi: false,
            timeoutMs: 10,
        }))
        world.provide('app:race', 'hit', leaf)
        expect(collected.values).toHaveLength(1)
        expect(scheduler.pendingTimeouts()).toBe(0)
        scheduler.flushTimeouts()
        expect(collected.errors).toEqual([])
        expect(collected.completed()).toBe(true)
    })

    it('drops the pending entry on unsubscribe with no residual timer', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler,
            token: 'app:gone',
            from: leaf,
            multi: false,
            timeoutMs: 50,
        }))
        expect(world.pendingCount()).toBe(1)
        collected.unsubscribe()
        expect(world.pendingCount()).toBe(0)
        expect(scheduler.pendingTimeouts()).toBe(0)
        world.provide('app:gone', 'too-late', leaf)
        expect(collected.values).toEqual([])
    })
})

describe('watchOnce multi (first-non-empty)', () => {
    it('settles on the first non-empty snapshot', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const collected = collect(watchOnce({ transport: world.transport, scheduler, token: 'app:tags', from: leaf, multi: true }))
        world.provide('app:tags', 'first', leaf)
        expect(collected.completed()).toBe(true)
        expect(collected.values).toHaveLength(1)
    })

    it('ignores empty arrays and never completes on them', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const seen: Array<unknown> = []
        let completed = false
        let errored: unknown = null
        const subscription = watchOnce({ transport: world.transport, scheduler, token: 'app:tags', from: leaf, multi: true }).subscribe({
            next: (value) => {
                seen.push(value)
            },
            error: (error: unknown) => {
                errored = error
            },
            complete: () => {
                completed = true
            },
        })
        void subscription
        void errored
        world.provide('app:other', 'unrelated', leaf)
        expect(seen).toEqual([])
        expect(completed).toBe(false)
        world.provide('app:tags', 'now', leaf)
        expect(seen).toHaveLength(1)
        expect(completed).toBe(true)
    })

    it('honours direction for multi snapshots', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const root = world.createHost()
        const leaf = world.createHost(root)
        world.provide('app:tag', 'leaf-tag', leaf)
        world.provide('app:tag', 'root-tag', root)
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler,
            token: 'app:tag',
            from: leaf,
            multi: true,
            direction: 'topDown',
        }))
        expect(collected.completed()).toBe(true)
        const [only] = collected.values as Array<ReadonlyArray<{ value: unknown }>>
        expect(only?.map((entry) => entry.value)).toEqual(['root-tag', 'leaf-tag'])
    })

    it('multi timeout still races first-wins', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler,
            token: 'app:mtags',
            from: leaf,
            multi: true,
            timeoutMs: 20,
        }))
        scheduler.flushTimeouts()
        expect(collected.errors).toHaveLength(1)
        expect((collected.errors[0] as DocumentContextError).code).toBe('RESOLUTION_TIMEOUT')
    })
})

describe('watchOnce target death via abort$', () => {
    it('errors DISPOSED_SESSION when the target session dies while pending', async () => {
        const { Subject } = await import('rxjs')
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const abort$ = new Subject<void>()
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler,
            token: 'app:scoped',
            from: leaf,
            multi: false,
            abort$: abort$.asObservable(),
        }))
        abort$.next()
        expect(collected.errors).toHaveLength(1)
        expect((collected.errors[0] as DocumentContextError).code).toBe('DISPOSED_SESSION')
        expect(world.pendingCount()).toBe(0)
        expect(scheduler.pendingTimeouts()).toBe(0)
    })

    it('lets a hit win over a later target death', async () => {
        const { Subject } = await import('rxjs')
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const abort$ = new Subject<void>()
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler,
            token: 'app:win',
            from: leaf,
            multi: false,
            abort$: abort$.asObservable(),
        }))
        world.provide('app:win', 'hit', leaf)
        abort$.next()
        expect(collected.values).toHaveLength(1)
        expect(collected.errors).toEqual([])
    })

    it('lets an earlier target death win over a later hit (death checked before delivery)', async () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const abort$ = new Subject<void>()
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler,
            token: 'app:race',
            from: leaf,
            multi: false,
            abort$: abort$.asObservable(),
        }))
        abort$.next()
        world.provide('app:race', 'too-late', leaf)
        expect(collected.values).toEqual([])
        expect(collected.errors).toHaveLength(1)
        expect((collected.errors[0] as DocumentContextError).code).toBe('DISPOSED_SESSION')
    })

    it('keeps a timeout settlement when a hit arrives after expiry (first-wins)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler,
            token: 'app:late-hit',
            from: leaf,
            multi: false,
            timeoutMs: 10,
        }))
        scheduler.flushTimeouts()
        expect((collected.errors[0] as DocumentContextError).code).toBe('RESOLUTION_TIMEOUT')
        world.provide('app:late-hit', 'too-late', leaf)
        expect(collected.values).toEqual([])
        expect(collected.errors).toHaveLength(1)
    })
})

describe('watchOnce single transport edges (first-wins, exactly-once)', () => {
    it('ignores a second emission after the first hit (single first-emit)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const transport = stubTransport({
            watch: (subscriber) => {
                subscriber.next(resolution('first'))
                subscriber.next(resolution('second'))
            },
        })
        const collected = collect(watchOnce({ transport, scheduler, token: 'app:twice', from: leaf, multi: false }))
        expect(collected.values).toHaveLength(1)
        expect((collected.values[0] as ScopeResolution<string>).value).toBe('first')
        expect(collected.completed()).toBe(true)
    })

    it('forwards a transport error to the waiter', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const cause = new Error('transport-boom')
        const transport = stubTransport({
            watch: (subscriber) => {
                subscriber.error(cause)
            },
        })
        const collected = collect(watchOnce({ transport, scheduler, token: 'app:err', from: leaf, multi: false }))
        expect(collected.values).toEqual([])
        expect(collected.errors).toHaveLength(1)
        expect(collected.errors[0]).toBe(cause)
        expect(collected.completed()).toBe(false)
    })

    it('ignores a transport error after the first hit (exactly-once)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const transport = stubTransport({
            watch: (subscriber) => {
                subscriber.next(resolution('hit'))
                subscriber.error(new Error('late-boom'))
            },
        })
        const collected = collect(watchOnce({ transport, scheduler, token: 'app:hit-err', from: leaf, multi: false }))
        expect(collected.values).toHaveLength(1)
        expect(collected.errors).toEqual([])
        expect(collected.completed()).toBe(true)
    })

    it('completes without emitting when the transport completes empty (single first-emit)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const transport = stubTransport({
            watch: (subscriber) => {
                subscriber.complete()
            },
        })
        const collected = collect(watchOnce({ transport, scheduler, token: 'app:empty', from: leaf, multi: false }))
        expect(collected.values).toEqual([])
        expect(collected.errors).toEqual([])
        expect(collected.completed()).toBe(true)
    })

    it('ignores a transport complete after the first hit (exactly-once)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const transport = stubTransport({
            watch: (subscriber) => {
                subscriber.next(resolution('hit'))
                subscriber.complete()
            },
        })
        const collected = collect(watchOnce({ transport, scheduler, token: 'app:hit-done', from: leaf, multi: false }))
        expect(collected.values).toHaveLength(1)
        expect(collected.errors).toEqual([])
        expect(collected.completed()).toBe(true)
    })

    it('settles exactly once when the scheduler ignores cancellation (settled timeout is a no-op)', () => {
        const world = createFakeScopeTransport()
        const manual = manualScheduler()
        const leaf = world.createHost()
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler: manual.port,
            token: 'app:race-timeout',
            from: leaf,
            multi: false,
            timeoutMs: 10,
        }))
        world.provide('app:race-timeout', 'hit', leaf)
        expect(collected.values).toHaveLength(1)
        for (const task of manual.tasks) {
            task()
        }
        expect(collected.values).toHaveLength(1)
        expect(collected.errors).toEqual([])
        expect(collected.completed()).toBe(true)
    })
})

describe('watchOnce multi transport edges (first-non-empty, empty never settles)', () => {
    it('ignores an empty snapshot and settles on the first non-empty one', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const transport = stubTransport({
            watchAll: (subscriber) => {
                subscriber.next([])
                subscriber.next([resolution('first'), resolution('second')])
            },
        })
        const collected = collect(watchOnce({ transport, scheduler, token: 'app:gaps', from: leaf, multi: true }))
        expect(collected.values).toHaveLength(1)
        expect((collected.values[0] as ReadonlyArray<ScopeResolution<string>>).map((entry) => entry.value)).toEqual(['first', 'second'])
        expect(collected.completed()).toBe(true)
    })

    it('ignores a second snapshot after settlement (multi first-non-empty)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const transport = stubTransport({
            watchAll: (subscriber) => {
                subscriber.next([resolution('first')])
                subscriber.next([resolution('second')])
            },
        })
        const collected = collect(watchOnce({ transport, scheduler, token: 'app:multi-twice', from: leaf, multi: true }))
        expect(collected.values).toHaveLength(1)
        expect((collected.values[0] as ReadonlyArray<ScopeResolution<string>>).map((entry) => entry.value)).toEqual(['first'])
        expect(collected.completed()).toBe(true)
    })

    it('forwards a multi transport error to the waiter', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const cause = new Error('multi-boom')
        const transport = stubTransport({
            watchAll: (subscriber) => {
                subscriber.error(cause)
            },
        })
        const collected = collect(watchOnce({ transport, scheduler, token: 'app:multi-err', from: leaf, multi: true }))
        expect(collected.values).toEqual([])
        expect(collected.errors).toHaveLength(1)
        expect(collected.errors[0]).toBe(cause)
    })

    it('ignores a multi transport error after settlement (exactly-once)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const transport = stubTransport({
            watchAll: (subscriber) => {
                subscriber.next([resolution('hit')])
                subscriber.error(new Error('late-multi-boom'))
            },
        })
        const collected = collect(watchOnce({ transport, scheduler, token: 'app:multi-hit-err', from: leaf, multi: true }))
        expect(collected.values).toHaveLength(1)
        expect(collected.errors).toEqual([])
        expect(collected.completed()).toBe(true)
    })

    it('stays pending when a third-party multi transport completes empty (empty never settles)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const transport = stubTransport({
            watchAll: (subscriber) => {
                subscriber.complete()
            },
        })
        const collected = collect(watchOnce({ transport, scheduler, token: 'app:multi-empty', from: leaf, multi: true }))
        expect(collected.values).toEqual([])
        expect(collected.errors).toEqual([])
        expect(collected.completed()).toBe(false)
        collected.unsubscribe()
    })

    it('ignores a multi complete after settlement (exactly-once)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const transport = stubTransport({
            watchAll: (subscriber) => {
                subscriber.next([resolution('hit')])
                subscriber.complete()
            },
        })
        const collected = collect(watchOnce({ transport, scheduler, token: 'app:multi-hit-done', from: leaf, multi: true }))
        expect(collected.values).toHaveLength(1)
        expect(collected.errors).toEqual([])
        expect(collected.completed()).toBe(true)
    })

    it('completes on abort without emitting for multi watches (signal forwarded)', () => {
        const world = createFakeScopeTransport()
        const scheduler = createFakeScheduler()
        const leaf = world.createHost()
        const controller = new AbortController()
        const collected = collect(watchOnce({
            transport: world.transport,
            scheduler,
            token: 'app:multi-abort',
            from: leaf,
            multi: true,
            signal: controller.signal,
        }))
        controller.abort()
        expect(collected.values).toEqual([])
        expect(collected.completed()).toBe(true)
        world.provide('app:multi-abort', 'too-late', leaf)
        expect(collected.values).toEqual([])
        collected.unsubscribe()
    })
})
