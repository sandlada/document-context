import { DocumentContextError } from './errors'
import { dispose } from './dispose'
import {
    createInternalSessionState,
    getElementSession,
    setElementSession,
    setInternalSession,
    type IInternalSessionState
} from './session-internal'
import type { IContextBlueprint, ISession } from './types'

/**
 * Runtime plugin invoked once per `mount()` call, after the session handle is
 * cached but before blueprint `mount` hooks run.
 *
 * A plugin may return a zero-argument cleanup (synchronous or promise-like)
 * that is pushed onto the session dispose stack and executed LIFO at
 * `dispose()` time. The built-in bridge, storage, and DOM-responder plugins
 * are all registered through this mechanism.
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
 * Mounts a pure blueprint onto a physical host element (Phase 2 execution
 * boundary), activating the runtime session.
 *
 * Idempotent per element: mounting the same `HTMLElement` twice returns the
 * existing non-disposed session instead of creating a second one. On a fresh
 * mount the pipeline is: create internal state (BehaviorSubject seeded from
 * `blueprint.initialState`) → cache session in both WeakMaps → run global
 * mount plugins in order → run blueprint `mount` hooks FIFO (promise cleanups
 * are attached when they settle) → dispatch a bubbling, composed
 * `context-mount` CustomEvent with `detail: { session }`.
 *
 * Plugin and hook throws never propagate; they are routed to the session
 * error stream as `MOUNT_PLUGIN_ERROR` / `MOUNT_HOOK_ERROR`.
 *
 * @param blueprint - Immutable Phase 1 blueprint definition.
 * @returns A curried function accepting the host `HTMLElement` and returning
 * the live `ISession`. The same element returns the same session until it is
 * disposed.
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
 * ```
 */
export function mount<S extends Record<PropertyKey, any>, Services>(
    blueprint: IContextBlueprint<S, Services>
): (element: HTMLElement) => ISession<S, Services> {
    return (element: HTMLElement) => {
        const existing = getElementSession<S>(element)
        if (existing && !existing.isDisposed) {
            return existing as unknown as ISession<S, Services>
        }

        const internal = createInternalSessionState<S>(element, blueprint)

        const session: ISession<S, Services> = {
            target: element,
            blueprint,
            get abortSignal() {
                return internal.abortController.signal
            },
            get isDisposed() {
                return internal.isDisposed
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

        // Execute registered global mount plugins (bridge, storage, dom observer)
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
