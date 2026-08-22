import { DocumentContextError } from './errors'
import { dispose } from './dispose'
import {
    createInternalSessionState,
    getElementSession,
    setElementSession,
    setInternalSession
} from './session-internal'
import type { IContextBlueprint, ISession } from './types'
import { setupProviderResponder } from '../dom/inject'
import { trackElementForGC } from '../dom/observer'
import { setupBridge } from '../bridge/with-bridge'
import { setupStorage } from '../storage/sync'

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

        // Track element for zero-leak lifecycle GC
        trackElementForGC(element, session)

        // Attach storage persistence & hydration if configured
        if (blueprint.storage) {
            const removeStorage = setupStorage(session, blueprint.storage)
            internal.cleanups.push(removeStorage)
        }

        // Attach W3C context-request event responder
        const removeResponder = setupProviderResponder(element, session)
        internal.cleanups.push(removeResponder)

        // Activate bidirectional bridges if configured
        for (const bridgeOptions of blueprint.bridges) {
            const removeBridge = setupBridge(element, session, bridgeOptions)
            internal.cleanups.push(removeBridge)
        }

        // Execute FIFO mount hooks
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
