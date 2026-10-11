/**
 * StoragePort contract and persistence option shapes.
 *
 * This module declares types only and performs no runtime work. Adapters MUST
 * return `StorageResult` values and MUST NOT throw, so every failure stays
 * data; adapters MUST handle only strings while serialization and version
 * envelopes live in the application layer. It stays importable in a plain
 * Node environment.
 */
import type { Observable } from 'rxjs'

/**
 * A value delivered synchronously by default, or as a promise to support
 * asynchronous backends such as IndexedDB. Shared with `ScopeTransportPort`.
 * Thenable detection MUST use duck-typing (`typeof x.then === 'function'`);
 * `instanceof Promise` is forbidden.
 */
export type MaybePromise<T> = T | Promise<T>

/**
 * Storage failure kinds. Failures surface as `StorageResult` data, never as
 * thrown exceptions; fatal routing to `errors$` happens above this port.
 */
export type StorageError =
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'corrupt', readonly raw: string }
    | { readonly kind: 'quota' }
    | { readonly kind: 'unknown', readonly cause: unknown }

/**
 * Result envelope every `StoragePort` method returns instead of throwing.
 *
 * @param T Success payload type.
 */
export type StorageResult<T> =
    | { readonly ok: true, readonly value: T }
    | { readonly ok: false, readonly error: StorageError }

/**
 * Driven port abstracting a string-only persistence backend. `observe$`
 * emits only external changes (cross-tab, other sources); self-writes MUST
 * NOT reflux through it.
 */
export interface StoragePort {
    /**
     * Reads the string stored under `key`.
     *
     * @param key Storage key.
     * @returns `{ ok: true, value: null }` on a miss, or `{ ok: false, error }`
     * on failure. Never throws.
     */
    read(key: string): MaybePromise<StorageResult<string | null>>
    /**
     * Writes a string under `key`.
     *
     * @param key Storage key.
     * @param value String payload; serialization happens above this port.
     * @returns `{ ok: true, value: undefined }` on success, or
     * `{ ok: false, error }` on failure. Never throws, never refluxes
     * through `observe$`.
     */
    write(key: string, value: string): MaybePromise<StorageResult<void>>
    /**
     * Removes the entry stored under `key`.
     *
     * @param key Storage key.
     * @returns `{ ok: true, value: undefined }` on success, or
     * `{ ok: false, error }` on failure. Never throws.
     */
    remove(key: string): MaybePromise<StorageResult<void>>
    /**
     * Hot stream of external changes for `key`. Self-writes MUST NOT emit.
     *
     * @param key Storage key to observe.
     * @returns Observable of the latest external value, or null on external
     * removal.
     * @example
     * ```ts
     * import type { StoragePort } from './storage.js'
     *
     * const watchKey = (port: StoragePort, key: string): void => {
     *     port.observe$(key).subscribe((value) => {
     *         void value
     *     })
     * }
     * ```
     */
    observe$(key: string): Observable<string | null>
}

/**
 * Declaration-merging slot for storage keywords. Consumers augment it to
 * register custom backends resolvable by name alongside the built-ins.
 *
 * @example
 * ```ts
 * import type { StorageKeywords } from './storage.js'
 *
 * declare module './storage.js' {
 *     interface StorageKeywords {
 *         readonly indexedDb: true
 *     }
 * }
 * ```
 */
export interface StorageKeywords {
    /** Built-in browser localStorage backend. */
    readonly localStorage: true
    /** Built-in browser sessionStorage backend. */
    readonly sessionStorage: true
}

/**
 * Persistence options consumed by the `persist` blueprint operator.
 * Serialization, hydration precedence, migration, and conflict policy all
 * live above the `StoragePort`, which only moves strings.
 *
 * @param S Session state shape the persisted snapshot merges into.
 */
export interface StorageOptions<S extends Record<PropertyKey, unknown> = Record<PropertyKey, unknown>> {
    /** Backend keyword resolved by the application registry, or a custom port. */
    readonly storage: keyof StorageKeywords | StoragePort
    /** Storage key for the version-enveloped payload. */
    readonly key: string
    /** Hydration precedence; defaults to `storageFirst`. */
    readonly hydration?: 'storageFirst' | 'payloadFirst' | 'blueprintFirst' | 'merge'
    /** Expected payload version; defaults to `0`. */
    readonly version?: number
    /** Single-step synchronous migration from an older stored shape. */
    readonly migrate?: (persisted: unknown, oldVersion: number) => Partial<S>
    /** Whether cross-tab changes flow back in; defaults to `true`. */
    readonly crossTab?: boolean
    /** Conflict policy for external snapshots; defaults to `'lww'`. */
    readonly conflict?: 'lww' | 'ignore-external' | ((local: S, remote: S) => S)
}
