/**
 * Storage infrastructure composition root.
 *
 * This module re-exports the storage adapters and the cross-tab sync
 * transport, and composes them into the keyword registry consumed by the
 * application layer. Importing this entry pulls both Web Storage backends;
 * bundle-sensitive consumers should import `local-storage.js` or
 * `session-storage.js` directly to keep the unused backend out of the graph.
 * Adapter instances stay lazy regardless: `createStorageAdapters()` builds no
 * backend until the first `resolve()` for that keyword.
 */
import type { StoragePort } from '../../domain/ports/storage.js'
import type { StorageRegistry as ApplicationStorageRegistry } from '../../application/context.js'
import { createLocalStorageAdapter } from './local-storage.js'
import type { ClosableStoragePort } from './local-storage.js'
import { createSessionStorageAdapter } from './session-storage.js'

export { createLocalStorageAdapter } from './local-storage.js'
export type { ClosableStoragePort, LocalStorageAdapterInit } from './local-storage.js'
export { createSessionStorageAdapter } from './session-storage.js'
export type { SessionStorageAdapterInit } from './session-storage.js'
export {
    attachStorageEvent,
    channelNameFor,
    compareEnvelopes,
    createCrossTabSync,
    createTabId,
    decodeEnvelope,
    encodeEnvelope,
    getTabId,
    storageLockNameFor,
    withStorageLock,
} from './sync.js'
export type {
    CrossTabRemoteHandler,
    CrossTabSyncHandle,
    CrossTabSyncOptions,
    StorageSyncEnvelope,
} from './sync.js'

/**
 * Keyword registry resolving storage backends by name. The `resolve`
 * contract is canonical in `application/context.js` (type-only import,
 * erased at runtime); this interface only adds the infrastructure-owned
 * `close` teardown. Unknown keywords resolve to null so the caller raises
 * `UNKNOWN_SERVICE`; the registry never throws and never fabricates backends.
 */
export interface StorageRegistry extends ApplicationStorageRegistry {
    /**
     * Closes every instantiated backend, releasing channels and window
     * listeners. Idempotent.
     */
    close(): void
}

/**
 * Creates the storage keyword registry with lazy per-keyword singleton
 * instantiation: requesting `localStorage` never constructs (or pulls into
 * the hot path) the `sessionStorage` backend, and unrequested keywords cost
 * nothing. Pure factory: no DOM is touched until the first `resolve()`.
 *
 * @returns The storage registry for application assembly.
 * @example
 * ```ts
 * import { createStorageAdapters } from './index.js'
 *
 * const storage = createStorageAdapters()
 * const backend = storage.resolve('localStorage')
 * storage.close()
 * ```
 */
export function createStorageAdapters(): StorageRegistry {
    let local: ClosableStoragePort | null = null
    let session: ClosableStoragePort | null = null
    return {
        resolve(keyword: string): StoragePort | null {
            if (keyword === 'localStorage') {
                if (local === null) {
                    local = createLocalStorageAdapter()
                }
                return local
            }
            if (keyword === 'sessionStorage') {
                if (session === null) {
                    session = createSessionStorageAdapter()
                }
                return session
            }
            return null
        },
        close(): void {
            if (local !== null) {
                try {
                    local.close()
                } catch {
                    // Adapter teardown is best-effort; registry disposal must not throw.
                }
                local = null
            }
            if (session !== null) {
                try {
                    session.close()
                } catch {
                    // Adapter teardown is best-effort; registry disposal must not throw.
                }
                session = null
            }
        },
    }
}
