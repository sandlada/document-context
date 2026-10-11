/**
 * Application assembly context: the per-`createApplication` mutable shell
 * holding ports, session indexes, and shared channels.
 *
 * This module is composition infrastructure, not domain logic: it allocates
 * maps and a `Subject`, performs no DOM access, starts no timers, and runs
 * in a plain Node environment. Factories in `api/` receive the context and
 * bind it into the public verbs; parallel tracks import
 * {@link ApplicationContext} from here as their only application-level type.
 */

import { Subject } from 'rxjs'
import type { HostPort, MountSessionRecord, SchedulerPort, ScopeTransportPort, Session, StoragePort } from '../domain/index.js'

/**
 * Host-keyed session index: native host object to its live mount handle and
 * domain record. Backed by a `WeakMap`, so dropping the native host releases
 * the entry without explicit cleanup.
 */
export interface HostSessionMap {
    /**
     * Reads the entry for a native host object.
     *
     * @param native Native host object used as the `WeakMap` key.
     * @returns The live entry, or undefined when the host was never mounted.
     */
    get(native: object): { facade: Session, record: MountSessionRecord<any> } | undefined
    /**
     * Stores the entry for a native host object, overwriting any previous one.
     *
     * @param native Native host object used as the `WeakMap` key.
     * @param entry Live facade plus its domain mount record.
     */
    set(native: object, entry: { facade: Session, record: MountSessionRecord<any> }): void
    /**
     * Forgets the entry for a native host object.
     *
     * @param native Native host object used as the `WeakMap` key.
     */
    delete(native: object): void
}

/**
 * Token-keyed session index: normalized keyed identity to its live facade.
 * Backed by `WeakRef`, so a disposed session with no other owner stops
 * resolving; dead entries are pruned on every access.
 */
export interface KeyedSessionMap {
    /**
     * Reads the live facade for a token, pruning collected entries first.
     *
     * @param token Normalized keyed identity.
     * @returns The live facade, or undefined on a miss or a collected facade.
     */
    get(token: string): Session | undefined
    /**
     * Stores the facade for a token, overwriting any previous one.
     *
     * @param token Normalized keyed identity.
     * @param facade Live session facade held by weak reference.
     */
    set(token: string, facade: Session): void
    /**
     * Forgets the entry for a token.
     *
     * @param token Normalized keyed identity.
     */
    delete(token: string): void
}

/**
 * Per-application singleton slot: either the resolved instance or the
 * in-flight promise shared by concurrent resolutions. Rejections are evicted
 * by the resolving layer so retries re-invoke the factory.
 */
export type SingletonEntry = { status: 'resolved', value: unknown } | { status: 'inflight', promise: Promise<unknown> }

/**
 * Host adapter injected at the composition root: host normalization plus the
 * scheduler, scope transport, and keyed-identity token storage.
 */
export interface HostAdapter {
    /**
     * Normalizes a mount target into its `HostPort` facade.
     *
     * @param node Mount target (element, `HostPort`, or `Session`).
     * @returns The host facade for the target.
     */
    toHost(node: unknown): HostPort
    /** Scheduler owning every notion of time for this application. */
    scheduler: SchedulerPort
    /** Scope transport resolving services along host parent chains. */
    scopeTransport: ScopeTransportPort
    /** Keyed-identity token storage on native hosts. */
    tokens: {
        /**
         * Reads the normalized keyed identity stored on a native host.
         *
         * @param native Native host to inspect.
         * @returns The stored token, or null for anonymous hosts.
         */
        read(native: unknown): string | null
        /**
         * Writes (or clears, with null) the keyed identity on a native host.
         *
         * @param native Native host to annotate.
         * @param token Token to store, or null to remove the annotation.
         */
        write(native: unknown, token: string | null): void
    }
}

/**
 * Storage backend registry resolving persistence keywords to ports.
 * Lazy per keyword: unregistered keywords stay out of the bundle.
 */
export interface StorageRegistry {
    /**
     * Resolves a storage keyword to its port.
     *
     * @param keyword Backend keyword (for example `'localStorage'`).
     * @returns The port, or null when the keyword is unregistered.
     */
    resolve(keyword: string): StoragePort | null
}

/**
 * One-shot SSR payload reader: returns the preloaded state for a token, or
 * null on a miss or a read failure. Never throws; failures degrade to null.
 */
export interface PayloadResolver {
    /**
     * Reads the payload stored for a token.
     *
     * @param token Normalized keyed identity, or null for anonymous sessions.
     * @returns The preloaded payload, or null when absent or unreadable.
     */
    (token: string | null): unknown | null
}

/**
 * Options accepted by `serialize`: an optional projection over the snapshot.
 * Without `select` the full snapshot is serialized.
 *
 * @param S Session state shape being serialized.
 */
export interface SerializeOptions<S> {
    /** Projects the snapshot before serialization; defaults to the full state. */
    readonly select?: (state: S) => unknown
}

/**
 * SSR adapter injected per request: a connectionless host, the payload
 * reader, and the payload serializer.
 */
export interface SsrAdapter {
    /** Connectionless host stub for server-side mounts. */
    nullHost: HostPort
    /** One-shot payload reader, or null when the request carries no payload. */
    payloadResolver: PayloadResolver | null
    /**
     * Serializes a session snapshot (or its `select` projection) to a JSON
     * payload string with `<`, `>`, `&`, U+2028, and U+2029 escaped.
     * The method generic carries the state constraint; the options interface
     * itself stays exactly as specified.
     *
     * @param options Optional projection over the snapshot.
     * @returns Data-last serializer mapping a session to its payload string.
     */
    serialize: <S extends Record<PropertyKey, unknown>>(options?: SerializeOptions<S>) => (session: Session<S>) => string
}

/**
 * Ports injected at the composition root by `createApplication`. The observer
 * policy defaults to `'auto'`; per-mount options override it with mount wins.
 */
export interface ApplicationPorts {
    /** Host adapter: normalization, scheduler, transport, token storage. */
    host: HostAdapter
    /** Storage backend registry for `persist` keywords. */
    storage: StorageRegistry
    /** SSR adapter; absent in pure browser applications. */
    ssr?: SsrAdapter
    /** Application-level observer policy; defaults to `'auto'`. */
    observer?: 'auto' | 'off'
}

/**
 * Mutable per-application shell shared by every bound verb. Factories take
 * this context and close over it; nothing here is observable except through
 * the verbs. `sessions` and `keyed` are the two independent identity maps:
 * the same string may name both a singleton slot and a keyed session without
 * either being visible through the other.
 */
export interface ApplicationContext {
    /** Injected ports for this application instance. */
    ports: ApplicationPorts
    /** Host-keyed live session index (`WeakMap`-backed). */
    sessions: HostSessionMap
    /** Token-keyed live session index (`WeakRef`-backed, dead-pruned). */
    keyed: KeyedSessionMap
    /** Facade-keyed domain mount records. */
    records: WeakMap<object, MountSessionRecord<Record<PropertyKey, unknown>>>
    /** Per-application singleton slots keyed by token string. */
    singletons: Map<string, SingletonEntry>
    /** Hot rescan channel: `attach` and observer wiring push `next()` here. */
    settled$: Subject<void>
}

/**
 * Creates the `WeakMap`-backed host session index. Pure factory: no DOM, no
 * timers, no shared globals; every call yields an independent map.
 *
 * @returns The new host session index.
 * @example
 * ```ts
 * import { createHostSessionMap } from './context.js'
 *
 * const sessions = createHostSessionMap()
 * sessions.set({}, { facade, record })
 * ```
 */
export function createHostSessionMap(): HostSessionMap {
    const entries = new WeakMap<object, { facade: Session, record: MountSessionRecord<any> }>()
    return {
        get(native: object): { facade: Session, record: MountSessionRecord<any> } | undefined {
            return entries.get(native)
        },
        set(native: object, entry: { facade: Session, record: MountSessionRecord<any> }): void {
            entries.set(native, entry)
        },
        delete(native: object): void {
            entries.delete(native)
        },
    }
}

/**
 * Creates the `WeakRef`-backed keyed session index with dead-prune on
 * access. Every `get` and `set` first sweeps collected facades, so disposed
 * sessions with no other owner stop resolving without explicit cleanup.
 * Pure factory: no DOM, no timers, no shared globals.
 *
 * @returns The new keyed session index.
 * @example
 * ```ts
 * import { createKeyedSessionMap } from './context.js'
 *
 * const keyed = createKeyedSessionMap()
 * keyed.set('app:box', session)
 * ```
 */
export function createKeyedSessionMap(): KeyedSessionMap {
    const refs = new Map<string, WeakRef<Session>>()
    const prune = (): void => {
        for (const [token, ref] of refs) {
            if (ref.deref() === undefined) {
                refs.delete(token)
            }
        }
    }
    return {
        get(token: string): Session | undefined {
            prune()
            return refs.get(token)?.deref()
        },
        set(token: string, facade: Session): void {
            prune()
            refs.set(token, new WeakRef(facade))
        },
        delete(token: string): void {
            refs.delete(token)
        },
    }
}

/**
 * Creates the mutable shell for one `createApplication` call: fresh session
 * indexes, an empty singleton table, and a hot `settled$` rescan channel.
 * Pure factory: no DOM, no timers; the `ports` reference is stored as given.
 *
 * @param ports Injected host, storage, and optional SSR ports.
 * @returns The new application context.
 * @example
 * ```ts
 * import { createApplicationContext } from './context.js'
 *
 * const ctx = createApplicationContext({ host, storage })
 * ```
 */
export function createApplicationContext(ports: ApplicationPorts): ApplicationContext {
    return {
        ports,
        sessions: createHostSessionMap(),
        keyed: createKeyedSessionMap(),
        records: new WeakMap<object, MountSessionRecord<Record<PropertyKey, unknown>>>(),
        singletons: new Map<string, SingletonEntry>(),
        settled$: new Subject<void>(),
    }
}
