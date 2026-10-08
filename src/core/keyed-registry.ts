import type { ISession } from './types'

/**
 * One per-document registry entry. Sessions are held weakly so the registry
 * never extends a session lifetime; explicit unregistration (dispose, TTL
 * expiry, `unregisterKeyedSession`) is the primary cleanup path and dead
 * references are additionally collected lazily on lookup.
 */
interface IKeyedRegistryEntry {
    ref: WeakRef<ISession<any, any>>
}

/**
 * Per-document keyed session registries. The `Document` is the natural scope
 * boundary (iframe isolation); entries never hold a strong `ISession`
 * reference.
 */
const documentRegistries = new WeakMap<Document, Map<string, IKeyedRegistryEntry>>()

/**
 * Fallback cleanup: when a registered session is garbage-collected without an
 * explicit unregistration, drop its entry — but only when the entry still
 * points at this exact `WeakRef`, so a later registration under the same key is
 * never evicted by a stale callback.
 */
const finalizationRegistry =
    typeof FinalizationRegistry !== 'undefined'
        ? new FinalizationRegistry<{
              document: Document
              key: string
              entry: IKeyedRegistryEntry
          }>((held) => {
              const map = documentRegistries.get(held.document)
              if (map && map.get(held.key) === held.entry) {
                  map.delete(held.key)
              }
          })
        : null

function getDocumentRegistry(doc: Document): Map<string, IKeyedRegistryEntry> {
    let map = documentRegistries.get(doc)
    if (!map) {
        map = new Map()
        documentRegistries.set(doc, map)
    }
    return map
}

/**
 * Registers a live keyed session under its resolved key within one document.
 *
 * Called by `mount()` when a fresh keyed session is created. Registering under
 * an existing key overwrites the previous entry (the newer session wins).
 * Intentional overwrite only happens at the mount boundary, where conflict
 * policy has already approved the replacement.
 *
 * @param doc - Owning document (scope of the registry).
 * @param key - Resolved session key.
 * @param session - Live session to park under the key.
 * @returns `void`.
 */
export function registerKeyedSession(
    doc: Document,
    key: string,
    session: ISession<any, any>
): void {
    const entry: IKeyedRegistryEntry = { ref: new WeakRef(session) }
    getDocumentRegistry(doc).set(key, entry)
    finalizationRegistry?.register(session, { document: doc, key, entry })
}

/**
 * Looks up the live session parked under a resolved key.
 *
 * Returns the session even while it is suspended (that is the resuscitation
 * window). Dead entries are collected lazily: when the weak reference can no
 * longer be dereferenced, the entry is deleted and treated as a miss.
 *
 * @param doc - Owning document (scope of the registry).
 * @param key - Resolved session key.
 * @returns The parked `ISession`, or `undefined` on miss.
 */
export function lookupKeyedSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    doc: Document,
    key: string
): ISession<S, any> | undefined {
    const map = documentRegistries.get(doc)
    if (!map) {
        return undefined
    }
    const entry = map.get(key)
    if (!entry) {
        return undefined
    }
    const session = entry.ref.deref()
    if (!session) {
        map.delete(key)
        return undefined
    }
    return session as ISession<S, any>
}

/**
 * Removes the entry parked under a resolved key.
 *
 * When `ref` is provided, the entry is only removed if it still points at that
 * exact session — protecting against evicting a successor registered under the
 * same key after a resuscitation moved the previous session elsewhere.
 *
 * @param doc - Owning document (scope of the registry).
 * @param key - Resolved session key.
 * @param ref - Optional session that must match the current entry.
 * @returns `void`.
 */
export function unregisterKeyedSessionEntry(
    doc: Document,
    key: string,
    ref?: ISession<any, any>
): void {
    const map = documentRegistries.get(doc)
    if (!map) {
        return
    }
    if (ref !== undefined) {
        const entry = map.get(key)
        if (entry && entry.ref.deref() !== ref) {
            return
        }
    }
    map.delete(key)
}
