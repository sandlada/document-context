/**
 * Persist write-back wiring: microtask-batched storage writes with a
 * newer-blocked guard and last-write-wins remote apply.
 *
 * Phase: runtime (application layer). The factory is pure: calling
 * `createPersistWiring` performs no I/O and schedules nothing; it subscribes
 * to `state$` (skipping the hydrated first value, so hydration never echoes
 * back) and returns the wiring handle. Side effects: one coalesced storage
 * write per microtask batch through `scheduler.microtask` (no timers, no
 * DOM), plus `INVALID_STORAGE_DATA` reports through `report`, which the
 * mount track routes to `errors$`. Idempotency: rapid updates coalesce to a
 * single write of the latest snapshot, and a manual `flush()` subsumes any
 * pending scheduled flush. Lifecycle: `dispose()` cancels the pending
 * microtask, performs one final best-effort `flush()`, and tears down the
 * subscription; afterwards automatic writes stop while a manual `flush()`
 * stays callable.
 *
 * Batching follows 06-storage.md section 6.5: state changes merge into one
 * microtask write, `dispose` flushes synchronously-when-possible for sync
 * adapters and best-effort for async adapters, and write failures report
 * `INVALID_STORAGE_DATA` with `details.op: 'write'` (once per failure
 * episode; a success resets the latch) while later updates keep retrying
 * with no backoff. Newer-blocked backends (hydrate outcome `newer-blocked`,
 * 06-storage.md section 6.4) stay read-only: every flush is intercepted and
 * reported once with `details.op: 'write', details.guarded: true` until the
 * backend unblocks or a write succeeds. Remote snapshots apply through the
 * `decide` conflict hook (default last-write-wins replace) with byte/shape
 * equality short-circuiting, and the apply never echoes back into storage:
 * emissions caused by `onRemote` itself are skipped by the write path under
 * an echo guard while remaining visible to subscribers. Counter and
 * accumulator states lose increments under last-write-wins; give cross-tab
 * counters `crossTab: false` or a merging `decide` function (see
 * 06-storage.md section 6.5).
 *
 * Mid-hydration note: external updates arriving before hydration completes
 * are queued by the mount wiring (phase 2, owned by the parallel mount
 * track) and delivered here post-hydration through `onRemote`; this module
 * assumes it is created after hydration with the hydrated snapshot as the
 * live `state$` value, so the skipped first emission is exactly that seed
 * and pre-creation history never schedules a write.
 */

import { skip } from 'rxjs'
import type { Observable, Subscription } from 'rxjs'
import { DocumentContextError } from '../domain/model/errors.js'
import { isThenable } from '../domain/ports/scope-transport.js'
import type { MaybePromise, StorageResult } from '../domain/ports/storage.js'
import type { SchedulerPort } from '../domain/ports/scheduler.js'

/**
 * Dependencies consumed by {@link createPersistWiring}. The caller owns
 * serialization (the `write` callback receives the live snapshot and
 * persists the version envelope itself), the hydrate-derived block guard,
 * and error routing; this module owns batching, guard latches, and the
 * echo-free remote apply.
 */
export interface PersistWriteDeps<S> {
    /** Hot state stream; the first (hydrated) emission is skipped. */
    readonly state$: Observable<S>
    /** Reads the current snapshot at flush time. */
    readonly getSnapshot: () => S
    /** Replaces the whole snapshot for remote applies. */
    readonly setState: (next: S) => void
    /** Scheduler owning microtask batching; no timers are used. */
    readonly scheduler: SchedulerPort
    /** Serializes the envelope and writes one snapshot; failures stay data, never throws. */
    readonly write: (snapshot: S) => MaybePromise<StorageResult<void>>
    /** Newer-blocked write guard from the hydrate outcome. */
    readonly isBlocked: () => boolean
    /** Routes `INVALID_STORAGE_DATA` onward (the mount track pushes to `errors$`); must not throw. */
    readonly report: (error: DocumentContextError) => void
    /** Conflict hook mapping local plus remote to the snapshot to adopt, or `'ignore'` to drop; defaults to last-write-wins replace. */
    readonly decide?: (local: S, remote: S) => S | 'ignore'
    /** Byte/shape equality short-circuit; defaults to a JSON compare. */
    readonly isEqual?: (a: S, b: S) => boolean
}

/**
 * Persist wiring handle returned by {@link createPersistWiring}.
 */
export interface PersistWiring<S> {
    /**
     * Tears down the wiring: cancels the pending microtask, performs one
     * final best-effort `flush()` (async failures still report), and
     * unsubscribes. Idempotent; sync backends flush synchronously.
     *
     * @returns The final flush result when the backend is async, else undefined.
     */
    dispose(): MaybePromise<void>
    /**
     * Writes the current snapshot immediately, subsuming any pending
     * scheduled flush. Unconditional: callers decide when a flush is due.
     *
     * @returns The write result when the backend is async, else undefined.
     */
    flush(): MaybePromise<void>
    /**
     * Applies one external snapshot through `decide` (the caller guarantees
     * local state was flushed first: flush-then-apply). Drops `'ignore'`
     * verdicts and snapshots equal to local state; otherwise replaces the
     * snapshot without scheduling a write-back echo. No-op after dispose.
     *
     * @param remote External snapshot to consider.
     */
    onRemote(remote: S): void
}

/**
 * Creates the persist write-back wiring over injected dependencies.
 *
 * Phase: pure factory; subscribing skips the hydrated first value and
 * schedules nothing. Purity: creating the wiring never reads storage and
 * never writes. Side effects: one coalesced `scheduler.microtask` flush per
 * update batch, plus `report` calls for guarded or failed writes.
 * Idempotency: each emission batch writes at most once; `dispose()` runs
 * once. Lifecycle: the subscription ends on `dispose()`; `onRemote` after
 * dispose is a silent no-op.
 *
 * @param deps State stream, snapshot accessors, scheduler, writer, block guard, reporter, and optional conflict hooks.
 * @returns The wiring handle with `dispose`, `flush`, and `onRemote`.
 * @throws Rethrows `decide` failures to the caller; `isEqual` failures degrade to not-equal.
 * @example
 * ```ts
 * import { createSessionState } from '../domain/model/session.js'
 * import { createPersistWiring } from './persist-wiring.js'
 *
 * const store = createSessionState({ count: 0 })
 * const wiring = createPersistWiring({
 *     state$: store.state$,
 *     getSnapshot: () => store.getSnapshot(),
 *     setState: (next) => store.setState(next),
 *     scheduler,
 *     write: (snapshot) => ({ ok: true, value: undefined }),
 *     isBlocked: () => false,
 *     report: (error) => console.log(error.code),
 * })
 * ```
 */
export function createPersistWiring<S>(deps: PersistWriteDeps<S>): PersistWiring<S> {
    const decide = deps.decide ?? ((_local: S, remote: S): S | 'ignore' => remote)
    const isEqual = deps.isEqual ?? ((a: S, b: S): boolean => {
        try {
            return JSON.stringify(a) === JSON.stringify(b)
        } catch {
            return false
        }
    })
    let disposed = false
    let scheduled = false
    let epoch = 0
    let echoGuard = false
    let blockedLatched = false
    let writeLatched = false

    const settleOk = (result: StorageResult<void>): void => {
        if (result.ok) {
            writeLatched = false
            return
        }
        if (!writeLatched) {
            writeLatched = true
            deps.report(new DocumentContextError('INVALID_STORAGE_DATA', { op: 'write', error: result.error }))
        }
    }

    const settleThrown = (error: unknown): void => {
        if (!writeLatched) {
            writeLatched = true
            deps.report(new DocumentContextError('INVALID_STORAGE_DATA', { op: 'write', error }))
        }
    }

    const flush = (): MaybePromise<void> => {
        scheduled = false
        epoch += 1
        if (deps.isBlocked()) {
            if (!blockedLatched) {
                blockedLatched = true
                deps.report(new DocumentContextError('INVALID_STORAGE_DATA', { op: 'write', guarded: true }))
            }
            return undefined
        }
        blockedLatched = false
        let produced: MaybePromise<StorageResult<void>>
        try {
            produced = deps.write(deps.getSnapshot())
        } catch (error) {
            settleThrown(error)
            return undefined
        }
        if (isThenable(produced)) {
            return Promise.resolve(produced).then(
                (result: unknown) => {
                    settleOk(result as StorageResult<void>)
                },
                (error: unknown) => {
                    settleThrown(error)
                },
            )
        }
        settleOk(produced)
        return undefined
    }

    const scheduleFlush = (): void => {
        if (disposed || scheduled) {
            return
        }
        scheduled = true
        epoch += 1
        const ticket = epoch
        deps.scheduler.microtask(() => {
            scheduled = false
            if (disposed || ticket !== epoch) {
                return
            }
            void flush()
        })
    }

    const subscription: Subscription = deps.state$.pipe(skip(1)).subscribe(() => {
        if (echoGuard) {
            return
        }
        scheduleFlush()
    })

    const onRemote = (remote: S): void => {
        if (disposed) {
            return
        }
        const local = deps.getSnapshot()
        const decided = decide(local, remote)
        if (decided === 'ignore') {
            return
        }
        let equal = false
        try {
            equal = isEqual(local, decided)
        } catch {
            equal = false
        }
        if (equal) {
            return
        }
        echoGuard = true
        try {
            deps.setState(decided)
        } finally {
            echoGuard = false
        }
    }

    const dispose = (): MaybePromise<void> => {
        if (disposed) {
            return undefined
        }
        disposed = true
        scheduled = false
        subscription.unsubscribe()
        try {
            return flush()
        } catch {
            return undefined
        }
    }

    return { dispose, flush, onRemote }
}
