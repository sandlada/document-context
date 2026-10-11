/**
 * Late-binding pending registry: the per-Document watch channel behind
 * `ScopeTransportPort.watch` / `watchAll`.
 *
 * This module is infrastructure: it touches no framework state and performs
 * no I/O beyond `queueMicrotask` batching. It owns no providers and answers
 * no resolution itself; it only retains caller-supplied `retry` closures and
 * replays them when a wake-up source (a `context-mount` announcement or the
 * centralized `MutationObserver`) reports fresh structure. Retries run in
 * microtask batches bounded per pass, chained across microtasks when over
 * budget, so there is no polling and no resident timer.
 *
 * The registry satisfies the frozen `PendingWake` contract by interface
 * extension (`PendingRegistry extends PendingWake`): `add({ token, host,
 * retry })` returns an idempotent remove function. The host is retained as
 * a `WeakRef` only; retry closures MUST NOT strongly capture the host,
 * element, or session (capture discipline per 09b §9b.3). Every wake call
 * prunes dead refs first, then retries.
 */
import type { HostPort } from '../../domain/ports/host.js'
import type { Token } from '../../domain/model/token.js'
import type { PendingWake } from './scope-transport.js'

/**
 * Caller-supplied pending entry. `token` and `retry` are captured by the
 * retry closure contract; `host` is wrapped in a `WeakRef` immediately and
 * never retained strongly past the `add` call.
 */
export interface PendingEntryInput {
    /** Token to match on wake-up (string by value, private object by reference). */
    readonly token: Token
    /** Consumer host, retained weakly; dead hosts are pruned, never retried. */
    readonly host: HostPort
    /** Re-resolution attempt; expected to remove itself (via the returned
     * remove function) once it settles. MUST NOT throw by contract; a throw
     * is contained, reported to the dev ledger, and the entry is retained. */
    readonly retry: () => void
    /** Optional overflow-eviction hook. Fires only when the entry is dropped
     * to respect `maxPending` (the transport maps this to a
     * `RESOLUTION_TIMEOUT` settlement). Explicit removal, abort, prune drops,
     * and `clear` never fire it. */
    readonly onEvict?: () => void
    /** Optional abort signal; aborting removes the entry immediately. An
     * already-aborted signal makes `add` a no-op returning a no-op remover. */
    readonly signal?: AbortSignal
}

/**
 * Dev-ledger event. Counts, ages, and token samples only; values never
 * appear. The hook fires (warn) without settling anything: it is never a
 * determinism point.
 */
export interface PendingLedgerEvent {
    /** `overflow` on oldest-first eviction, `high-water` when a prune-only
     * pass is armed, `retry-error` when a retry closure throws. */
    readonly kind: 'overflow' | 'high-water' | 'retry-error'
    /** Live entry count at report time. */
    readonly count: number
    /** Age of the oldest live entry in milliseconds. */
    readonly oldestAgeMs: number
    /** Up to five token names (`'<private>'` for private tokens); never values. */
    readonly tokens: ReadonlyArray<string>
}

/**
 * Tuning options for {@link createPendingRegistry}. Every field is optional;
 * omitted fields take documented defaults. Bounds are tunable pending D1
 * final parameter selection.
 */
export interface PendingRegistryOptions {
    /** Maximum live entries per Document; overflow evicts oldest-first with
     * `onEvict` notice. Defaults to `1000`. */
    readonly maxPending?: number
    /** Maximum retries per microtask pass; overflow chains another microtask
     * FIFO behind the current one (deferred-first, no starvation). Defaults
     * to `128`. */
    readonly maxBatch?: number
    /** Crossing this size arms a one-shot prune-only microtask (no retries,
     * no timer). Defaults to `maxPending`. */
    readonly highWaterMark?: number
    /** Dev-ledger hook; undefined (default) means zero-cost silence. A
     * composer wires `console.warn` here in dev builds only. */
    readonly onEvent?: (event: PendingLedgerEvent) => void
}

/**
 * Pending-request registry handle. All wake paths prune dead refs first;
 * retries are microtask-batched; `retryAll` is the synchronous driver hatch
 * for deterministic tests. Extends the frozen `PendingWake` contract, so any
 * registry value plugs directly into `createScopeTransport({ wake })` and
 * `createHostAdapter({ wake })`.
 */
export interface PendingRegistry extends PendingWake {
    /**
     * Registers a pending entry and returns its idempotent remove function.
     *
     * @param entry Token, weakly-held host, retry closure, plus optional
     * eviction hook and abort signal.
     * @returns Idempotent remove function dropping the entry silently.
     */
    add(entry: PendingEntryInput): () => void
    /**
     * Counts currently held entries (including not-yet-pruned dead refs;
     * call `prune` first for an exact live count).
     *
     * @returns The current entry count.
     */
    size(): number
    /**
     * Drops removed-flagged and deref-empty entries, detaching their abort
     * hooks without dispatching retries.
     *
     * @returns The number of entries dropped.
     */
    prune(): number
    /**
     * Synchronously runs retries for one token bucket (or every entry when
     * `token` is omitted), skipping dead refs. Deterministic driver hatch;
     * the async wake paths batch through microtasks instead.
     *
     * @param token Optional token narrowing the drain (string by value,
     * private object by reference).
     * @returns The number of retries invoked.
     */
    retryAll(token?: Token): number
    /**
     * Wakes entries whose host is the mounted host or its descendant (fast
     * path), filtered by `providedTokens` when present. Private-token entries
     * always join the subtree scan; unreadable natives fall back to inclusion
     * (correctness over precision). Prunes first, then batches retries.
     *
     * @param mountedHost Host that just mounted (wake-up origin).
     * @param providedTokens Optional service-token strings just provided;
     * absent means full-scan fallback.
     */
    wakeSubtree(mountedHost: HostPort, providedTokens?: ReadonlyArray<string>): void
    /**
     * Wakes every pending entry (whole-document correctness fallback),
     * optionally narrowed by `providedTokens`. Prunes first, then batches.
     *
     * @param providedTokens Optional service-token strings just provided;
     * absent means retry everything.
     */
    wakeAll(providedTokens?: ReadonlyArray<string>): void
    /**
     * Drops every entry without firing `onEvict`. Teardown path; transports
     * are already torn down when this runs.
     */
    clear(): void
}

interface PendingRecord {
    readonly token: Token
    readonly hostRef: WeakRef<HostPort>
    readonly retry: () => void
    onEvict: (() => void) | undefined
    readonly addedAt: number
    removed: boolean
    abortOff: (() => void) | null
}

const DEFAULT_MAX_PENDING = 1000
const DEFAULT_MAX_BATCH = 128
const LEDGER_TOKEN_SAMPLE = 5
const CONTAINED_BY = 16

const tokenLabel = (token: Token): string => typeof token === 'string' ? token : '<private>'

const readNativeElement = (host: HostPort): Element | null => {
    let native: unknown
    try {
        native = host.native()
    } catch {
        return null
    }
    if (typeof native !== 'object' || native === null) {
        return null
    }
    return native as Element
}

const containsOrSelf = (ancestor: Element, node: Element): boolean => {
    if (ancestor === node) {
        return true
    }
    try {
        const position = ancestor.compareDocumentPosition(node)
        if (typeof position === 'number') {
            return (position & CONTAINED_BY) !== 0
        }
    } catch {
        // Fall through to contains(), then to fail-open inclusion below.
    }
    try {
        if (typeof ancestor.contains === 'function') {
            return ancestor.contains(node)
        }
    } catch {
        // Fail open: correctness fallback includes the entry.
    }
    return true
}

/**
 * Creates a per-Document pending-request registry. Pure factory except for
 * the `queueMicrotask` batching it schedules on wake-ups: no DOM reads, no
 * timers, no shared globals; every call yields an independent registry.
 *
 * Overflow evicts oldest-first, firing `onEvict` per dropped entry (the
 * transport maps that notice to `RESOLUTION_TIMEOUT`; the registry itself
 * settles nothing). Dead hosts are pruned on every wake call before any
 * retry runs. Retries never capture the host through this module: only a
 * `WeakRef` is stored.
 *
 * @param options Optional `maxPending`, `maxBatch`, `highWaterMark`, and
 * dev-ledger hook overrides.
 * @returns The new registry handle.
 * @example
 * ```ts
 * import { createPendingRegistry } from './late-binding.js'
 *
 * const pending = createPendingRegistry({ maxPending: 500 })
 * const remove = pending.add({ token: 'app:theme', host, retry })
 * pending.wakeAll()
 * remove()
 * ```
 */
export function createPendingRegistry(options: PendingRegistryOptions = {}): PendingRegistry {
    const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING
    const maxBatch = options.maxBatch ?? DEFAULT_MAX_BATCH
    const highWaterMark = options.highWaterMark ?? maxPending
    const onEvent = options.onEvent

    const order: Array<PendingRecord> = []
    const buckets = new Map<Token, Set<PendingRecord>>()
    const queue: Array<PendingRecord> = []
    const queued = new Set<PendingRecord>()
    let flushScheduled = false
    let pruneScheduled = false

    const report = (kind: PendingLedgerEvent['kind']): void => {
        if (onEvent === undefined) {
            return
        }
        const live = order.filter((record) => !record.removed && record.hostRef.deref() !== undefined)
        const oldest = live.reduce((min, record) => Math.min(min, record.addedAt), Date.now())
        onEvent({
            kind,
            count: live.length,
            oldestAgeMs: Math.max(0, Date.now() - oldest),
            tokens: live.slice(0, LEDGER_TOKEN_SAMPLE).map((record) => tokenLabel(record.token)),
        })
    }

    const detach = (record: PendingRecord): void => {
        record.removed = true
        record.abortOff?.()
        record.abortOff = null
        queued.delete(record)
        const bucket = buckets.get(record.token)
        if (bucket !== undefined) {
            bucket.delete(record)
            if (bucket.size === 0) {
                buckets.delete(record.token)
            }
        }
    }

    const pruneRecords = (): number => {
        let dropped = 0
        for (let index = order.length - 1; index >= 0; index -= 1) {
            const record = order[index] as PendingRecord
            if (record.removed) {
                order.splice(index, 1)
                dropped += 1
            } else if (record.hostRef.deref() === undefined) {
                detach(record)
                order.splice(index, 1)
                dropped += 1
            }
        }
        return dropped
    }

    const evictOverflow = (): void => {
        if (order.length <= maxPending) {
            return
        }
        pruneRecords()
        while (order.length > maxPending) {
            const oldest = order.shift() as PendingRecord | undefined
            if (oldest === undefined) {
                return
            }
            detach(oldest)
            try {
                oldest.onEvict?.()
            } catch {
                // Eviction notice must never break registration; reported below.
            }
            report('overflow')
        }
    }

    const armPruneOnly = (): void => {
        if (pruneScheduled) {
            return
        }
        pruneScheduled = true
        report('high-water')
        queueMicrotask(() => {
            pruneScheduled = false
            pruneRecords()
        })
    }

    const flush = (): void => {
        flushScheduled = false
        pruneRecords()
        let ran = 0
        while (queue.length > 0 && ran < maxBatch) {
            const record = queue.shift() as PendingRecord | undefined
            if (record === undefined) {
                break
            }
            queued.delete(record)
            if (record.removed) {
                continue
            }
            if (record.hostRef.deref() === undefined) {
                detach(record)
                const index = order.indexOf(record)
                if (index >= 0) {
                    order.splice(index, 1)
                }
                continue
            }
            try {
                record.retry()
            } catch {
                report('retry-error')
            }
            ran += 1
        }
        if (queue.length > 0) {
            flushScheduled = true
            queueMicrotask(flush)
        }
    }

    const ensureFlush = (): void => {
        if (!flushScheduled) {
            flushScheduled = true
            queueMicrotask(flush)
        }
    }

    const enqueue = (record: PendingRecord): void => {
        if (record.removed || queued.has(record)) {
            return
        }
        queued.add(record)
        queue.push(record)
    }

    const collect = (providedTokens: ReadonlyArray<string> | undefined, inScope: (host: HostPort) => boolean): void => {
        const allow = providedTokens === undefined ? null : new Set(providedTokens)
        for (const record of order) {
            if (record.removed) {
                continue
            }
            const host = record.hostRef.deref()
            if (host === undefined) {
                continue
            }
            if (allow !== null && typeof record.token === 'string' && !allow.has(record.token)) {
                continue
            }
            if (!inScope(host)) {
                continue
            }
            enqueue(record)
        }
        ensureFlush()
    }

    const registry: PendingRegistry = {
        add(entry: PendingEntryInput): () => void {
            if (entry.signal?.aborted === true) {
                return () => {}
            }
            const record: PendingRecord = {
                token: entry.token,
                hostRef: new WeakRef(entry.host),
                retry: entry.retry,
                onEvict: entry.onEvict,
                addedAt: Date.now(),
                removed: false,
                abortOff: null,
            }
            order.push(record)
            let bucket = buckets.get(record.token)
            if (bucket === undefined) {
                bucket = new Set<PendingRecord>()
                buckets.set(record.token, bucket)
            }
            bucket.add(record)
            const signal = entry.signal
            if (signal !== undefined) {
                const onAbort = (): void => {
                    record.abortOff = null
                    if (!record.removed) {
                        detach(record)
                        const index = order.indexOf(record)
                        if (index >= 0) {
                            order.splice(index, 1)
                        }
                    }
                }
                record.abortOff = () => signal.removeEventListener('abort', onAbort)
                signal.addEventListener('abort', onAbort, { once: true })
            }
            evictOverflow()
            if (order.length > highWaterMark) {
                armPruneOnly()
            }
            let removed = false
            return () => {
                if (removed) {
                    return
                }
                removed = true
                if (!record.removed) {
                    detach(record)
                    const index = order.indexOf(record)
                    if (index >= 0) {
                        order.splice(index, 1)
                    }
                }
            }
        },
        size(): number {
            return order.length
        },
        prune(): number {
            return pruneRecords()
        },
        retryAll(token?: Token): number {
            pruneRecords()
            const candidates = token === undefined ? [...order] : [...(buckets.get(token) ?? [])]
            let ran = 0
            for (const record of candidates) {
                if (record.removed || record.hostRef.deref() === undefined) {
                    continue
                }
                try {
                    record.retry()
                } catch {
                    report('retry-error')
                }
                ran += 1
            }
            return ran
        },
        wakeSubtree(mountedHost: HostPort, providedTokens?: ReadonlyArray<string>): void {
            pruneRecords()
            const root = readNativeElement(mountedHost)
            collect(providedTokens, (host) => {
                if (root === null) {
                    return true
                }
                const node = readNativeElement(host)
                if (node === null) {
                    return true
                }
                return containsOrSelf(root, node)
            })
        },
        wakeAll(providedTokens?: ReadonlyArray<string>): void {
            pruneRecords()
            collect(providedTokens, () => true)
        },
        clear(): void {
            for (const record of order) {
                detach(record)
            }
            order.length = 0
            queue.length = 0
            queued.clear()
        },
    }
    return registry
}
