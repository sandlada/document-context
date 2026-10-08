import {
    DocumentContextError,
    KeyedBlueprintMismatchError,
    KeyedSessionConflictError
} from './errors'
import { dispose } from './dispose'
import { resuscitateSession, suspendSession } from './keyed-lifecycle'
import {
    lookupKeyedSession,
    registerKeyedSession,
    unregisterKeyedSessionEntry
} from './keyed-registry'
import { applyKeyProjection, resolveSessionKey } from './session-key'
import {
    createInternalSessionState,
    getElementSession,
    getInternalSession,
    setElementSession,
    setInternalSession,
    type IInternalSessionState
} from './session-internal'
import type { IContextBlueprint, IMountOptions, ISession } from './types'

/**
 * Runtime plugin invoked once per `mount()` call, after the session handle is
 * cached but before blueprint `mount` hooks run.
 *
 * A plugin may return a zero-argument cleanup (synchronous or promise-like)
 * that is pushed onto the session dispose stack and executed LIFO at
 * `dispose()` time. The built-in DOM responder and GC-tracking integrations
 * are registered through the host-activation channel instead, so they can be
 * rebound on resuscitation.
 *
 * @param session - Freshly created live session.
 * @param internal - Internal mutable state (subjects, caches, flags).
 * @returns An optional cleanup, or a promise of one.
 */
export type MountPlugin = (
    session: ISession<any, any>,
    internal: IInternalSessionState<any>
) => void | (() => void) | Promise<void | (() => void)>

const globalMountPlugins: MountPlugin[] = []

/**
 * Registers a global runtime plugin executed during every `mount()`.
 *
 * Plugins run in registration order on each mount. Synchronous throws are
 * caught and routed to the session error stream as `MOUNT_PLUGIN_ERROR`, so
 * one failing plugin never prevents the session from mounting.
 *
 * @param plugin - Plugin callback; see {@link MountPlugin}.
 * @returns An unregister function that removes this exact plugin reference.
 * Calling it twice is safe (second call is a no-op).
 *
 * @example
 * ```ts
 * import { registerMountPlugin } from '@sandlada/document-context'
 *
 * const unregister = registerMountPlugin((session) => {
 *     console.log('mounted on', session.target)
 *     return () => console.log('disposed')
 * })
 * unregister()
 * ```
 */
export function registerMountPlugin(plugin: MountPlugin): () => void {
    globalMountPlugins.push(plugin)
    return () => {
        const index = globalMountPlugins.indexOf(plugin)
        if (index !== -1) {
            globalMountPlugins.splice(index, 1)
        }
    }
}

/**
 * Resolves `IMountOptions.suspensionTtlMs`: defaults to 50, clamps negative
 * values to 0, and lets `Infinity` through (never auto-dispose).
 */
function resolveSuspensionTtlMs(value: number | undefined): number {
    if (value === undefined || Number.isNaN(value)) {
        return 50
    }
    if (value === Infinity) {
        return Infinity
    }
    return Math.max(0, value)
}

/**
 * Mounts a pure blueprint onto a physical host element (Phase 2 execution
 * boundary), activating the runtime session.
 *
 * Idempotent per element: mounting the same `HTMLElement` twice with the same
 * blueprint instance and the same resolved key returns the existing
 * non-disposed session. Keyed mounts (`options.key` or a `data-context-key`
 * attribute, with the option authoritative and written back to the attribute)
 * additionally participate in cross-host identity: mounting a new host under a
 * key whose session is suspended or whose previous host disconnected
 * automatically resuscitates that session — same identity, same state, same
 * scoped services — while host activations (bridges, responder) are rebound
 * and `resuscitate` hooks fire. Conflicts follow `IMountOptions.onConflict`:
 * `'throw'` (default) raises `KeyedSessionConflictError` /
 * `KeyedBlueprintMismatchError`, `'evict'` hot-transfers a same-blueprint
 * session from a still-connected host, and `'reset'` disposes the previous
 * session before mounting fresh.
 *
 * On a fresh mount the pipeline is: create internal state (BehaviorSubject
 * seeded from `blueprint.initialState`) → cache session in both WeakMaps →
 * register the keyed entry and normalize the attribute projection → run
 * global mount plugins in order → run blueprint `mount` hooks FIFO (promise
 * cleanups are attached when they settle) → dispatch a bubbling, composed
 * `context-mount` CustomEvent with `detail: { session }`.
 *
 * Plugin and hook throws never propagate; they are routed to the session
 * error stream as `MOUNT_PLUGIN_ERROR` / `MOUNT_HOOK_ERROR`. Conflict errors
 * are fatal and thrown synchronously from the mount call.
 *
 * @param blueprint - Immutable Phase 1 blueprint definition.
 * @param options - Optional keyed identity, suspension TTL, and conflict
 * policy; see {@link IMountOptions}.
 * @returns A curried function accepting the host `HTMLElement` and returning
 * the live `ISession`. The same element returns the same session until it is
 * disposed; a new element under the same key may return a resuscitated
 * session.
 *
 * @example
 * ```ts
 * import { createContext, mount, select } from '@sandlada/document-context'
 *
 * const blueprint = createContext({ count: 0 })
 * const mountCounter = mount(blueprint)
 * const session = mountCounter(document.getElementById('counter')!)
 * const getCount = select((s: { count: number }) => s.count)
 * console.log(getCount(session))
 *
 * // Keyed identity: a replacement host reuses the same session.
 * const mountPanel = mount(blueprint, { key: 'cart-panel' })
 * mountPanel(document.getElementById('cart')!)
 * ```
 */
export function mount<S extends Record<PropertyKey, any>, Services>(
    blueprint: IContextBlueprint<S, Services>,
    options?: IMountOptions
): (element: HTMLElement) => ISession<S, Services> {
    return (element: HTMLElement) => {
        const key = resolveSessionKey(element, options?.key)
        const suspensionTtlMs = resolveSuspensionTtlMs(options?.suspensionTtlMs)
        const onConflict = options?.onConflict ?? 'throw'

        // 1. Same-element idempotency and conflict handling
        const existing = getElementSession<S>(element)
        if (existing && !existing.isDisposed) {
            const sameBlueprint = existing.blueprint === blueprint
            const sameKey = existing.key === key

            if (sameBlueprint && sameKey) {
                return existing as unknown as ISession<S, Services>
            }

            if (!sameBlueprint && onConflict !== 'reset') {
                throw new KeyedBlueprintMismatchError({
                    key: key ?? existing.key ?? '',
                    details: { existingKey: existing.key, incomingKey: key }
                })
            }

            if (sameBlueprint && !sameKey && onConflict !== 'reset') {
                throw new KeyedSessionConflictError({
                    key: key ?? existing.key ?? '',
                    existingElement: element,
                    incomingElement: element,
                    details: { existingKey: existing.key, incomingKey: key }
                })
            }

            dispose(existing)
        }

        // 2. Cross-host keyed identity: auto-resuscitation and conflicts
        if (key !== undefined) {
            const doc = element.ownerDocument
            const match = lookupKeyedSession<S>(doc, key)
            if (match) {
                const matchInternal = getInternalSession(match)
                if (match.isDisposed || !matchInternal) {
                    unregisterKeyedSessionEntry(doc, key, match)
                } else {
                    const sameBlueprint = match.blueprint === blueprint
                    const previousTarget = matchInternal.target

                    if (sameBlueprint && (matchInternal.isSuspended || !previousTarget.isConnected)) {
                        resuscitateSession(match, element)
                        return match as unknown as ISession<S, Services>
                    }

                    if (!sameBlueprint) {
                        if (onConflict === 'reset') {
                            dispose(match)
                        } else {
                            throw new KeyedBlueprintMismatchError({
                                key,
                                details: {
                                    previousElement: previousTarget,
                                    incomingElement: element
                                }
                            })
                        }
                    } else if (onConflict === 'evict') {
                        suspendSession(match, true)
                        resuscitateSession(match, element)
                        return match as unknown as ISession<S, Services>
                    } else if (onConflict === 'reset') {
                        dispose(match)
                    } else {
                        throw new KeyedSessionConflictError({
                            key,
                            existingElement: previousTarget,
                            incomingElement: element
                        })
                    }
                }
            }
        }

        // 3. Fresh session
        const internal = createInternalSessionState<S>(element, blueprint, key, suspensionTtlMs)

        const session: ISession<S, Services> = {
            blueprint,
            get target() {
                return internal.target
            },
            get abortSignal() {
                return internal.abortController.signal
            },
            get isDisposed() {
                return internal.isDisposed
            },
            get key() {
                return internal.key
            },
            get isSuspended() {
                return internal.isSuspended
            },
            [Symbol.dispose]() {
                dispose(session)
            },
            async [Symbol.asyncDispose]() {
                dispose(session)
            }
        } as unknown as ISession<S, Services>

        setInternalSession(session, internal)
        setElementSession(element, session)

        if (key !== undefined) {
            registerKeyedSession(element.ownerDocument, key, session)
            applyKeyProjection(element, key)
        }

        // Execute registered global mount plugins (dom responder, GC tracking)
        for (const plugin of globalMountPlugins) {
            try {
                const cleanup = plugin(session, internal)
                if (typeof cleanup === 'function') {
                    internal.cleanups.push(cleanup)
                }
            } catch (err) {
                internal.errorSubject.next(
                    new DocumentContextError({
                        code: 'MOUNT_PLUGIN_ERROR',
                        message: err instanceof Error ? err.message : String(err),
                        details: { error: String(err) }
                    })
                )
            }
        }

        // Execute FIFO mount hooks from blueprint
        const mountHooks = blueprint.hooks.filter((h) => h.event === 'mount')
        for (const hook of mountHooks) {
            try {
                const cleanup = hook.handler(session)
                if (typeof cleanup === 'function') {
                    internal.cleanups.push(cleanup)
                } else if (cleanup && typeof cleanup.then === 'function') {
                    cleanup
                        .then((resolvedCleanup: unknown) => {
                            if (typeof resolvedCleanup === 'function') {
                                internal.cleanups.push(resolvedCleanup as () => void)
                            }
                        })
                        .catch((err: unknown) => {
                            internal.errorSubject.next(
                                new DocumentContextError({
                                    code: 'MOUNT_HOOK_ERROR',
                                    message: err instanceof Error ? err.message : String(err),
                                    details: { hook: 'mount' }
                                })
                            )
                        })
                }
            } catch (err) {
                internal.errorSubject.next(
                    new DocumentContextError({
                        code: 'MOUNT_HOOK_ERROR',
                        message: err instanceof Error ? err.message : String(err),
                        details: { hook: 'mount' }
                    })
                )
            }
        }

        // Dispatch context-mount native DOM CustomEvent
        try {
            element.dispatchEvent(
                new CustomEvent('context-mount', {
                    bubbles: true,
                    composed: true,
                    detail: { session }
                })
            )
        } catch (err) {
            // Suppress event dispatch failures
        }

        return session
    }
}
