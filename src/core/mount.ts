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

export type MountPlugin = (
    session: ISession<any, any>,
    internal: IInternalSessionState<any>
) => void | (() => void) | Promise<void | (() => void)>

const globalMountPlugins: MountPlugin[] = []

/**
 * Registers a runtime plugin executed during the mount phase.
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
 * Mounts a pure blueprint to a physical DOM element, activating the runtime session boundary.
 *
 * @param blueprint The immutable blueprint definition.
 * @returns A curried function accepting the host HTMLElement.
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
