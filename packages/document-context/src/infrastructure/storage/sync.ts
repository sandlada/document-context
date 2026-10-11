/**
 * Cross-tab storage synchronization transport.
 *
 * This module is the transport half of cross-tab sync: it moves opaque
 * storage bytes between tabs over `BroadcastChannel` with a window
 * `storage`-event fallback. It never parses version envelopes authoritatively
 * and never touches application state; ordering (`compareEnvelopes`) and the
 * flush-then-compare application of remote snapshots live above this module.
 * No DOM is touched at import time; every global (`BroadcastChannel`,
 * `window`, `navigator`) is probed lazily per call so server runtimes import
 * safely and simply observe absent transports.
 */
import type { MaybePromise } from '../../domain/ports/storage.js'

/**
 * Wire envelope broadcast between tabs sharing one storage key. `kind`
 * records the operation (`write`, or `remove` when `d` is null); `v` is a
 * best-effort version stamp parsed from the payload (0 when the payload is
 * not a versioned envelope); `d` carries the opaque storage bytes so
 * receivers stay byte-exact without re-serializing. Ordering uses
 * `(ts, seq, tabId)` only; see {@link compareEnvelopes}.
 */
export interface StorageSyncEnvelope {
    /** Operation carried by the envelope: `write`, or `remove` when `d` is null. */
    readonly kind: 'write' | 'remove'
    /** Storage key this envelope belongs to. */
    readonly key: string
    /** Best-effort version stamp parsed from the payload; 0 when unknown. */
    readonly v: number
    /** Opaque storage bytes; null signals a removal. */
    readonly d: string | null
    /** Sender wall-clock (`Date.now()`); cross-tab skew is documented, never fair. */
    readonly ts: number
    /** Sender tab identity; empty for synthesized storage-event envelopes. */
    readonly tabId: string
    /** Per-tab monotonic sequence; 0 is reserved for storage-event envelopes. */
    readonly seq: number
}

/**
 * Callback invoked for each deliverable remote change.
 *
 * @param value Opaque remote bytes, or null for a remote removal.
 * @param envelope Full envelope carrying ordering metadata.
 */
export type CrossTabRemoteHandler = (value: string | null, envelope: StorageSyncEnvelope) => void

/**
 * Options accepted by {@link createCrossTabSync}.
 */
export interface CrossTabSyncOptions {
    /** Storage key synchronized by this handle. */
    readonly key: string
    /** Delivers remote changes after dedup and self-echo filtering. */
    readonly onRemote: CrossTabRemoteHandler
    /** Tab identity override; defaults to the shared per-realm id. Test seam. */
    readonly tabId?: string
}

/**
 * Live cross-tab sync binding for one storage key.
 */
export interface CrossTabSyncHandle {
    /** Tab identity used on every envelope sent by this handle. */
    readonly tabId: string
    /** BroadcastChannel name (`dc-storage:<key>`); empty when unsupported. */
    readonly channelName: string
    /**
     * Broadcasts opaque bytes to sibling tabs. Never throws; delivery is
     * best-effort with the storage-event fallback as the second channel.
     */
    send(value: string | null): void
    /** Closes the channel and detaches the storage listener; idempotent. */
    close(): void
}

const SEEN_BOUND = 128

let tabCounter = 0
let sequenceCounter = 0
let sharedTabId: string | null = null

/**
 * Creates a fresh tab identity. Prefers `crypto.randomUUID()` and falls back
 * to a `tab-<time>-<counter>-<random>` tag that is unique per realm but only
 * deterministic-ish: the counter is monotonic while the time and random
 * suffixes vary. Identity only needs tab-granularity, not secrecy.
 *
 * @returns A new tab identity string.
 * @example
 * ```ts
 * import { createTabId } from './sync.js'
 *
 * const tabId = createTabId()
 * ```
 */
export function createTabId(): string {
    try {
        const cryptoRef = (globalThis as unknown as { readonly crypto?: { readonly randomUUID?: () => string } }).crypto
        if (typeof cryptoRef?.randomUUID === 'function') {
            return cryptoRef.randomUUID()
        }
    } catch {
        // Exotic realms may deny crypto access; the counter fallback below still applies.
    }
    tabCounter += 1
    const random = Math.floor(Math.random() * 65535).toString(16).padStart(4, '0')
    return `tab-${Date.now().toString(36)}-${tabCounter.toString(36)}-${random}`
}

/**
 * Returns the shared per-realm tab identity, creating it on first use. Every
 * sync handle in one tab shares this id so same-tab siblings are recognized
 * while each handle's own sequences stay droppable; see `send` filtering.
 *
 * @returns The stable tab identity for this realm.
 * @example
 * ```ts
 * import { getTabId } from './sync.js'
 *
 * const tabId = getTabId()
 * ```
 */
export function getTabId(): string {
    if (sharedTabId === null) {
        sharedTabId = createTabId()
    }
    return sharedTabId
}

/**
 * Builds the `BroadcastChannel` name for a key. The key portion is
 * URL-escaped so exotic keys cannot break channel or lock naming.
 *
 * @param key Storage key.
 * @returns The channel name `dc-storage:<key>`.
 * @example
 * ```ts
 * import { channelNameFor } from './sync.js'
 *
 * const channel = channelNameFor('app:counter')
 * ```
 */
export function channelNameFor(key: string): string {
    return `dc-storage:${encodeURIComponent(key)}`
}

/**
 * Builds the Web Locks resource name for a key. Intentionally identical in
 * shape to {@link channelNameFor}: one key, one coordination namespace.
 *
 * @param key Storage key.
 * @returns The lock name `dc-storage:<key>`.
 * @example
 * ```ts
 * import { storageLockNameFor } from './sync.js'
 *
 * const lock = storageLockNameFor('app:counter')
 * ```
 */
export function storageLockNameFor(key: string): string {
    return `dc-storage:${encodeURIComponent(key)}`
}

/**
 * Encodes an envelope to its JSON wire form.
 *
 * @param envelope Envelope to encode.
 * @returns The JSON string posted to the channel.
 * @example
 * ```ts
 * import { compareEnvelopes, decodeEnvelope, encodeEnvelope } from './sync.js'
 *
 * const wire = encodeEnvelope({ kind: 'write', key: 'app:key', v: 0, d: 'x', ts: 1, tabId: 'tab-a', seq: 1 })
 * const back = decodeEnvelope(wire)
 * ```
 */
export function encodeEnvelope(envelope: StorageSyncEnvelope): string {
    return JSON.stringify(envelope)
}

/**
 * Decodes a wire string to an envelope, validating every field. Never throws:
 * any parse or shape failure degrades to null so corrupt broadcasts cannot
 * break receivers.
 *
 * @param raw Wire string received from the channel.
 * @returns The envelope, or null when the payload is not a valid envelope.
 * @example
 * ```ts
 * import { decodeEnvelope } from './sync.js'
 *
 * const envelope = decodeEnvelope('not json')
 * ```
 */
export function decodeEnvelope(raw: string): StorageSyncEnvelope | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw) as unknown
    } catch {
        return null
    }
    if (parsed === null || typeof parsed !== 'object') {
        return null
    }
    const candidate = parsed as Record<string, unknown>
    if (candidate['kind'] !== 'write' && candidate['kind'] !== 'remove') {
        return null
    }
    if (typeof candidate['key'] !== 'string') {
        return null
    }
    if (typeof candidate['v'] !== 'number') {
        return null
    }
    if (candidate['d'] !== null && typeof candidate['d'] !== 'string') {
        return null
    }
    if (typeof candidate['ts'] !== 'number' || typeof candidate['tabId'] !== 'string' || typeof candidate['seq'] !== 'number') {
        return null
    }
    return {
        kind: candidate['kind'],
        key: candidate['key'],
        v: candidate['v'],
        d: candidate['d'],
        ts: candidate['ts'],
        tabId: candidate['tabId'],
        seq: candidate['seq'],
    }
}

/**
 * Total last-write-wins order over `(ts, seq, tabId)`. Timestamps compare
 * first, per-tab sequences break ties, and the tab id breaks the rest, so any
 * two envelopes sort deterministically. `Date.now()` skew across tabs is
 * honest but unfixable here: physical simultaneity has no fairness promise.
 *
 * @param a First envelope.
 * @param b Second envelope.
 * @returns Negative when `a` is older, positive when newer, zero when equal.
 * @example
 * ```ts
 * import { compareEnvelopes } from './sync.js'
 *
 * const last = [local, remote].sort(compareEnvelopes).at(-1)
 * ```
 */
export function compareEnvelopes(a: StorageSyncEnvelope, b: StorageSyncEnvelope): number {
    if (a.ts !== b.ts) {
        return a.ts < b.ts ? -1 : 1
    }
    if (a.seq !== b.seq) {
        return a.seq < b.seq ? -1 : 1
    }
    if (a.tabId !== b.tabId) {
        return a.tabId < b.tabId ? -1 : 1
    }
    return 0
}

interface WebLocksLike {
    request<T>(name: string, options: { readonly mode: 'exclusive' }, callback: () => MaybePromise<T>): Promise<T>
}

/**
 * Reads the Web Locks API when present, without touching it at import time.
 *
 * @returns The locks surface, or null when absent or blocked.
 */
function readWebLocks(): WebLocksLike | null {
    try {
        if (typeof navigator === 'undefined') {
            return null
        }
        const locks = (navigator as unknown as { readonly locks?: unknown }).locks
        if (locks === null || locks === undefined) {
            return null
        }
        if (typeof (locks as { readonly request?: unknown }).request !== 'function') {
            return null
        }
        return locks as WebLocksLike
    } catch {
        return null
    }
}

/**
 * Runs a read-modify-write section under an exclusive `dc-storage:<key>`
 * lock when Web Locks exist, or directly otherwise. Locking only serializes
 * local writers; convergence across tabs still rests on
 * {@link compareEnvelopes}, so the unlocked fallback stays correct.
 *
 * @param key Storage key scoping the lock.
 * @param task Section to run inside the lock.
 * @returns The task result, synchronously when unlocked, as a promise under locks.
 * @example
 * ```ts
 * import { withStorageLock } from './sync.js'
 *
 * const result = await withStorageLock('app:counter', () => readModifyWrite())
 * ```
 */
export function withStorageLock<T>(key: string, task: () => MaybePromise<T>): MaybePromise<T> {
    const locks = readWebLocks()
    if (locks === null) {
        return task()
    }
    return locks.request(storageLockNameFor(key), { mode: 'exclusive' }, task)
}

/**
 * Attaches a window `storage`-event listener filtered to one key, delivering
 * the raw new value (null on removal). Storage events never fire in the tab
 * that wrote, so this path is inherently external-only. Missing `window`
 * degrades to a no-op detach function.
 *
 * @param key Storage key to watch.
 * @param onEvent Callback receiving the raw external value or null.
 * @returns Detach function removing the listener; idempotent.
 * @example
 * ```ts
 * import { attachStorageEvent } from './sync.js'
 *
 * const detach = attachStorageEvent('app:counter', (value) => { void value })
 * detach()
 * ```
 */
export function attachStorageEvent(key: string, onEvent: (value: string | null) => void): () => void {
    let target: Pick<typeof window, 'addEventListener' | 'removeEventListener'> | null = null
    try {
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            target = window
        }
    } catch {
        target = null
    }
    if (target === null) {
        return () => {}
    }
    const listener = target
    const handler = (event: Event): void => {
        const storageEvent = event as unknown as { readonly key?: unknown, readonly newValue?: unknown }
        if (storageEvent.key !== key) {
            return
        }
        onEvent(typeof storageEvent.newValue === 'string' ? storageEvent.newValue : null)
    }
    listener.addEventListener('storage', handler)
    let detached = false
    return () => {
        if (detached) {
            return
        }
        detached = true
        try {
            listener.removeEventListener('storage', handler)
        } catch {
            // Detach is best-effort; a failing remove must not break disposal.
        }
    }
}

/**
 * Best-effort version stamp parsed from opaque payload bytes. Versioned
 * `{v, d}` payloads contribute their `v`; anything else reports 0. Parsing
 * never throws; the stamp is informational and ordering never depends on it.
 *
 * @param value Opaque payload bytes, or null for a removal.
 * @returns The parsed version, or 0 when absent or unparsable.
 */
function versionOf(value: string | null): number {
    if (value === null) {
        return 0
    }
    try {
        const parsed = JSON.parse(value) as unknown
        if (parsed !== null && typeof parsed === 'object' && typeof (parsed as { readonly v?: unknown }).v === 'number') {
            return (parsed as { readonly v: number }).v
        }
    } catch {
        // Non-JSON payloads carry no version stamp.
    }
    return 0
}

/**
 * Creates the cross-tab sync binding for one storage key. The handle posts
 * envelopes to `dc-storage:<key>` and listens on both the channel and window
 * `storage` events. Reception applies byte-equal dedup (one last-received
 * cache shared by both channels, so a single logical write delivers once),
 * then the self-sequence filter (own `(tabId, seq)` pairs drop while
 * same-tab sibling sequences deliver), then a bounded `(tabId, seq)`
 * seen-set, and finally `onRemote`. BroadcastChannel absence degrades to the
 * storage-event channel with identical delivery semantics.
 *
 * @param options Key, remote handler, and optional tab identity override.
 * @returns The live sync handle; `close()` detaches every listener.
 * @example
 * ```ts
 * import { createCrossTabSync } from './sync.js'
 *
 * const sync = createCrossTabSync({ key: 'app:counter', onRemote: (value) => { void value } })
 * sync.send('{"v":0,"d":{"count":1}}')
 * sync.close()
 * ```
 */
export function createCrossTabSync(options: CrossTabSyncOptions): CrossTabSyncHandle {
    const key = options.key
    const onRemote = options.onRemote
    const tabId = options.tabId ?? getTabId()
    const channelName = channelNameFor(key)

    let closed = false
    let hasLastBytes = false
    let lastBytes: string | null = null
    const ownSequences: Array<number> = []
    const seenKeys: Array<string> = []
    const seenSet = new Set<string>()

    const rememberSeen = (seenKey: string): boolean => {
        if (seenSet.has(seenKey)) {
            return true
        }
        seenSet.add(seenKey)
        seenKeys.push(seenKey)
        if (seenKeys.length > SEEN_BOUND) {
            const oldest = seenKeys.shift()
            if (oldest !== undefined) {
                seenSet.delete(oldest)
            }
        }
        return false
    }

    const deliver = (value: string | null, envelope: StorageSyncEnvelope): void => {
        if (closed) {
            return
        }
        if (hasLastBytes && lastBytes === value) {
            return
        }
        hasLastBytes = true
        lastBytes = value
        onRemote(value, envelope)
    }

    const onBroadcastMessage = (event: { readonly data?: unknown }): void => {
        const raw = event.data
        if (typeof raw !== 'string') {
            return
        }
        const envelope = decodeEnvelope(raw)
        if (envelope === null || envelope.key !== key) {
            return
        }
        if (envelope.tabId === tabId && ownSequences.includes(envelope.seq)) {
            return
        }
        if (envelope.tabId !== '' && rememberSeen(`${envelope.tabId}:${envelope.seq}`)) {
            return
        }
        deliver(envelope.d, envelope)
    }

    let channel: BroadcastChannel | null = null
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            const opened = new BroadcastChannel(channelName)
            opened.onmessage = (event: MessageEvent) => {
                onBroadcastMessage(event)
            }
            channel = opened
        }
    } catch {
        channel = null
    }

    const detachStorage = attachStorageEvent(key, (value) => {
        deliver(value, {
            kind: value === null ? 'remove' : 'write',
            key,
            v: versionOf(value),
            d: value,
            ts: Date.now(),
            tabId: '',
            seq: 0,
        })
    })

    return {
        tabId,
        channelName,
        send(value: string | null): void {
            if (closed) {
                return
            }
            sequenceCounter += 1
            const seq = sequenceCounter
            ownSequences.push(seq)
            if (ownSequences.length > SEEN_BOUND) {
                ownSequences.shift()
            }
            hasLastBytes = true
            lastBytes = value
            if (channel === null) {
                return
            }
            const envelope: StorageSyncEnvelope = {
                kind: value === null ? 'remove' : 'write',
                key,
                v: versionOf(value),
                d: value,
                ts: Date.now(),
                tabId,
                seq,
            }
            try {
                channel.postMessage(encodeEnvelope(envelope))
            } catch {
                // Broadcast is best-effort; the storage-event channel still propagates.
            }
        },
        close(): void {
            if (closed) {
                return
            }
            closed = true
            detachStorage()
            if (channel !== null) {
                try {
                    channel.close()
                } catch {
                    // Close is best-effort and idempotent by flag.
                }
                channel = null
            }
            ownSequences.length = 0
            seenSet.clear()
            seenKeys.length = 0
        },
    }
}
