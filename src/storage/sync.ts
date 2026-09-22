import { InvalidStorageDataError } from '../core/errors'
import { getInternalSession } from '../core/session-internal'
import { update } from '../core/update'
import { registerMountPlugin } from '../core/mount'
import type { IStorageOptions, ISession } from '../core/types'
import {
    deserializeWithMigration,
    getStorageAdapter,
    serializeWithVersion
} from './adapters'
import { resolveHydratedState } from './hydration'

/**
 * Activates persistence, hydration, and cross-tab sync for a mounted session.
 *
 * Normally invoked by the `withStorage` mount hook (and redundantly by the
 * storage global mount plugin when `blueprint.storage` exists), not by hand.
 * The pipeline is: synchronous read + `resolveHydratedState()` seeding (async
 * adapters hydrate late via `update()` instead) → `BroadcastChannel`
 * `sandlada-sync-{key}` subscription (unless `crossTabSync === false`) →
 * state subscription persisting every emission through
 * `serializeWithVersion()` (coordinated by `navigator.locks` when available,
 * rebroadcasting to the channel) → window `storage`-event listener. Every
 * parse or write failure is routed to the session error stream as
 * `InvalidStorageDataError`; disposed sessions stop persisting and applying
 * remote updates.
 *
 * @param session - Live session to persist.
 * @param storageOptions - Storage config; see {@link IStorageOptions}.
 * @returns A cleanup unsubscribing the state feed, closing the channel, and
 * removing the `storage` listener. Sessions without internals yield an empty
 * cleanup.
 *
 * @example
 * ```ts
 * import { setupStorage } from '@sandlada/document-context'
 *
 * const cleanup = setupStorage(session, { adapter: 'localStorage', key: 'counter' })
 * cleanup()
 * ```
 */
export function setupStorage<S extends Record<PropertyKey, any>>(
    session: ISession<S, any>,
    storageOptions: IStorageOptions<S>
): () => void {
    const internal = getInternalSession(session)
    if (!internal) {
        return () => {}
    }

    const adapter = getStorageAdapter(storageOptions.adapter)
    let persistedData: Partial<S> | null = null

    // 1. Synchronous or Initial Read & Hydration
    try {
        const raw = adapter.getItem(storageOptions.key)
        if (typeof raw === 'string') {
            persistedData = deserializeWithMigration(
                raw,
                storageOptions.version ?? 1,
                storageOptions.migrate
            )
        } else if (raw && typeof (raw as any).then === 'function') {
            // Async adapter
            ;(raw as Promise<any>)
                .then((asyncRaw) => {
                    if (typeof asyncRaw === 'string') {
                        const data = deserializeWithMigration(
                            asyncRaw,
                            storageOptions.version ?? 1,
                            storageOptions.migrate
                        )
                        if (data && !session.isDisposed) {
                            update(data)(session)
                        }
                    }
                })
                .catch((err: unknown) => {
                    internal.errorSubject.next(
                        new InvalidStorageDataError({
                            key: storageOptions.key,
                            rawData: err,
                            details: { error: String(err) }
                        })
                    )
                })
        }
    } catch (err: unknown) {
        internal.errorSubject.next(
            new InvalidStorageDataError({
                key: storageOptions.key,
                rawData: err,
                details: { error: String(err) }
            })
        )
    }

    // Apply hydration precedence
    const hydratedState = resolveHydratedState(
        session.blueprint,
        session.target,
        persistedData,
        storageOptions.hydrationStrategy
    )
    internal.stateSubject.next(hydratedState)

    // BroadcastChannel channel setup
    let broadcastChannel: any = null
    if (
        storageOptions.crossTabSync !== false &&
        typeof BroadcastChannel !== 'undefined'
    ) {
        try {
            broadcastChannel = new BroadcastChannel(
                `sandlada-sync-${storageOptions.key}`
            )
            broadcastChannel.onmessage = (event: MessageEvent) => {
                if (event.data && !session.isDisposed) {
                    try {
                        const incoming = deserializeWithMigration(
                            event.data,
                            storageOptions.version ?? 1,
                            storageOptions.migrate
                        )
                        if (incoming) {
                            update(incoming)(session)
                        }
                    } catch (err) {
                        internal.errorSubject.next(
                            new InvalidStorageDataError({
                                key: storageOptions.key,
                                rawData: event.data,
                                details: { error: String(err) }
                            })
                        )
                    }
                }
            }
        } catch {
            // Suppress
        }
    }

    // 2. Persist State Changes with Web Locks API coordination
    const sub = internal.stateSubject.subscribe((state) => {
        if (session.isDisposed) {
            return
        }

        const persistWork = () => {
            try {
                const serialized = serializeWithVersion(
                    state,
                    storageOptions.version ?? 1
                )
                const res = adapter.setItem(storageOptions.key, serialized)
                if (res && typeof (res as any).then === 'function') {
                    ;(res as Promise<void>).catch((err: unknown) => {
                        internal.errorSubject.next(
                            new InvalidStorageDataError({
                                key: storageOptions.key,
                                rawData: err,
                                details: { error: String(err) }
                            })
                        )
                    })
                }

                if (broadcastChannel) {
                    broadcastChannel.postMessage(serialized)
                }
            } catch (err: unknown) {
                internal.errorSubject.next(
                    new InvalidStorageDataError({
                        key: storageOptions.key,
                        rawData: err,
                        details: { error: String(err) }
                    })
                )
            }
        }

        if (
            typeof navigator !== 'undefined' &&
            (navigator as any).locks &&
            typeof (navigator as any).locks.request === 'function'
        ) {
            ;(navigator as any).locks
                .request(`sandlada-lock-${storageOptions.key}`, async () => {
                    persistWork()
                })
                .catch(() => {
                    persistWork()
                })
        } else {
            persistWork()
        }
    })

    // 3. Cross-Tab Synchronization via Window StorageEvent
    let storageEventHandler: ((e: StorageEvent) => void) | undefined
    if (
        storageOptions.crossTabSync !== false &&
        typeof window !== 'undefined' &&
        typeof window.addEventListener === 'function'
    ) {
        storageEventHandler = (e: StorageEvent) => {
            if (e.key === storageOptions.key && e.newValue && !session.isDisposed) {
                try {
                    const incoming = deserializeWithMigration(
                        e.newValue,
                        storageOptions.version ?? 1,
                        storageOptions.migrate
                    )
                    if (incoming) {
                        update(incoming)(session)
                    }
                } catch (err: unknown) {
                    internal.errorSubject.next(
                        new InvalidStorageDataError({
                            key: storageOptions.key,
                            rawData: e.newValue,
                            details: { error: String(err) }
                        })
                    )
                }
            }
        }
        window.addEventListener('storage', storageEventHandler)
    }

    return () => {
        sub.unsubscribe()
        if (broadcastChannel) {
            broadcastChannel.close()
        }
        if (storageEventHandler && typeof window !== 'undefined') {
            window.removeEventListener('storage', storageEventHandler)
        }
    }
}

// Auto-register storage mount plugin
registerMountPlugin((session) => {
    if (session.blueprint.storage) {
        return setupStorage(session, session.blueprint.storage)
    }
})
