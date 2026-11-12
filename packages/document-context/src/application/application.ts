/**
 * The composition root.
 *
 * `createApplication` wires a set of ports into an application: the Phase 2 verbs and the session
 * index all live on the same runtime shell. Nothing is stored at module level — the application
 * instance is the isolation boundary.
 */

import type { Observable, Subscription } from 'rxjs'
import { DocumentContextError } from '../domain/model/errors'
import type { Blueprint, ProviderRegistration } from '../domain/model/blueprint'
import type { Host, LateTarget, MountTarget, Session } from '../domain/model/session'
import type { RegisteredService, TokenLike } from '../domain/model/token'
import type { ApplicationLimits, ApplicationPorts, CacheSlot, PendingRequest, ProviderCacheKey } from './context'
import type { SessionRuntime } from './session'
import { mountSession, type MountOptions } from './api/mount'
import { injectToken, injectToken$, type InjectOptions } from './api/inject'
import {
    injectAllTokens,
    injectAllTokens$,
    type InjectAllOptions,
} from './api/inject-all'
import { updateState, type StateUpdate } from './api/update'
import { readState } from './api/read'
import { disposeSession } from './api/dispose'
import { subscribeState } from './api/subscribe'
import { sessionAt, sessionStream } from './api/session-stream'
import { assertOwnedSession } from './application/isolation'
import { buildPorts, type ApplicationOptions } from './application/ports-contract'
import { scheduleRecheck } from './scheduling'
import { handleConfirmedDisconnect } from './lifecycle/disconnect'
import { schedulePendingRetry } from './pending'

/** The configuration of {@link Application.attach}. */
export interface AttachConfig<TOwner = any> {
    /** Called when the host becomes connected. */
    readonly onConnect?: () => void
    /** Called when the host becomes disconnected. */
    readonly onDisconnect?: () => void
    /** Called when the host node is adopted into another document or owner. */
    readonly onAdopt?: (owner: TOwner) => void
}

/** The handle returned by {@link Application.attach}. */
export interface AttachHandle {
    /** Stop forwarding connectivity facts. */
    detach(): void
}

/**
 * A wired application: every Phase 2 verb bound to one runtime shell.
 */
export interface Application<THost extends Host = Host, TTarget = unknown> {
    /** The ports this application was built with. */
    readonly ports: ApplicationPorts
    /** The application level limits. */
    readonly limits: ApplicationLimits
    /**
     * Mount a blueprint on a host.
     *
     * @param blueprint - The blueprint to mount.
     * @param options - The mount options.
     * @returns A function that takes the mount target and returns the session.
     */
    mount<S>(
        blueprint: Blueprint<S>,
        options?: MountOptions,
    ): (target: TTarget) => Session<S, THost>
    /**
     * Resolve a single dependency.
     *
     * @param token - The token to resolve.
     * @param options - The injection options.
     * @returns A function that takes the injection target.
     */
    inject<T>(token: TokenLike<T>, options?: InjectOptions): (target: LateTarget<TTarget>) => Promise<T>
    /**
     * Resolve a single dependency.
     *
     * @param token - The token name.
     * @param options - The injection options.
     * @returns A function that takes the injection target.
     */
    inject<K extends string>(
        token: K,
        options?: InjectOptions,
    ): (target: LateTarget<TTarget>) => Promise<RegisteredService<K>>
    /**
     * Resolve a single dependency.
     *
     * @param token - The token name.
     * @param options - The injection options.
     * @returns A function that takes the injection target.
     */
    inject<T>(token: string, options?: InjectOptions): (target: LateTarget<TTarget>) => Promise<T>
    /**
     * Resolve a single dependency as a stream.
     *
     * @param token - The token to resolve.
     * @param options - The injection options.
     * @returns A function that takes the injection target.
     */
    inject$<T>(token: TokenLike<T>, options?: InjectOptions): (target: LateTarget<TTarget>) => Observable<T>
    /**
     * Resolve a single dependency as a stream.
     *
     * @param token - The token name.
     * @param options - The injection options.
     * @returns A function that takes the injection target.
     */
    inject$<K extends string>(
        token: K,
        options?: InjectOptions,
    ): (target: LateTarget<TTarget>) => Observable<RegisteredService<K>>
    /**
     * Resolve a single dependency as a stream.
     *
     * @param token - The token name.
     * @param options - The injection options.
     * @returns A function that takes the injection target.
     */
    inject$<T>(token: string, options?: InjectOptions): (target: LateTarget<TTarget>) => Observable<T>
    /**
     * Collect every multi-value provider of a token.
     *
     * @param token - The token to collect.
     * @param options - The injection options.
     * @returns A function that takes the injection target.
     */
    injectAll<T>(
        token: TokenLike<T>,
        options?: InjectAllOptions,
    ): (target: LateTarget<TTarget>) => Promise<T[]>
    /**
     * Collect every multi-value provider of a token.
     *
     * @param token - The token name.
     * @param options - The injection options.
     * @returns A function that takes the injection target.
     */
    injectAll<K extends string>(
        token: K,
        options?: InjectAllOptions,
    ): (target: LateTarget<TTarget>) => Promise<RegisteredService<K>[]>
    /**
     * Collect every multi-value provider of a token.
     *
     * @param token - The token name.
     * @param options - The injection options.
     * @returns A function that takes the injection target.
     */
    injectAll<T>(token: string, options?: InjectAllOptions): (target: LateTarget<TTarget>) => Promise<T[]>
    /**
     * Collect every multi-value provider of a token as a stream.
     *
     * @param token - The token to collect.
     * @param options - The injection options.
     * @returns A function that takes the injection target.
     */
    injectAll$<T>(
        token: TokenLike<T>,
        options?: InjectAllOptions,
    ): (target: LateTarget<TTarget>) => Observable<T[]>
    /**
     * Collect every multi-value provider of a token as a stream.
     *
     * @param token - The token name.
     * @param options - The injection options.
     * @returns A function that takes the injection target.
     */
    injectAll$<K extends string>(
        token: K,
        options?: InjectAllOptions,
    ): (target: LateTarget<TTarget>) => Observable<RegisteredService<K>[]>
    /**
     * Collect every multi-value provider of a token as a stream.
     *
     * @param token - The token name.
     * @param options - The injection options.
     * @returns A function that takes the injection target.
     */
    injectAll$<T>(
        token: string,
        options?: InjectAllOptions,
    ): (target: LateTarget<TTarget>) => Observable<T[]>
    /**
     * Read the current snapshot of a session.
     *
     * The state type cannot be inferred from the selector alone; annotate the callback parameter
     * (or pass the type argument) when the shape is not obvious.
     *
     * @param selector - The projection applied to the snapshot.
     * @returns A function that takes the session.
     */
    read<S = any, R = any>(selector: (state: S) => R): (session: Session<S, any>) => R
    /**
     * Replace the state of a session.
     *
     * The state type cannot be inferred from the updater alone; annotate the callback parameter
     * (or pass the type argument) when the shape is not obvious.
     *
     * @param updater - The next snapshot, or a synchronous function that returns it.
     * @returns A function that takes the session.
     */
    update<S = any>(updater: StateUpdate<S>): (session: Session<S, any>) => boolean
    /**
     * Observe the state of a session.
     *
     * @param listener - The listener.
     * @returns A function that takes the session.
     */
    subscribe$<S>(listener: (state: S) => void): (session: Session<S, any>) => Subscription
    /**
     * The nearest session of an element.
     *
     * @param target - The element.
     * @returns The session, or `null`.
     */
    sessionAt(target: TTarget): Session<any, THost> | null
    /**
     * Track the nearest session of an element.
     *
     * @param target - The element.
     * @returns The observable.
     */
    session$(target: TTarget): Observable<Session<any, THost> | null>
    /**
     * Dispose a session.
     *
     * @param session - The session.
     */
    dispose(session: Session<any, any>): void
    /**
     * Forward connectivity facts of an existing session.
     *
     * @param config - The callbacks.
     * @returns A function that takes the session.
     */
    attach(config: AttachConfig): (session: Session<any, any>) => AttachHandle
    /**
     * Release the application. Idempotent.
     */
    release(): void
}

class ApplicationImpl<THost extends Host, TTarget> implements Application<THost, TTarget> {
    readonly ports: ApplicationPorts
    readonly limits: ApplicationLimits
    readonly sessions = new Map<Host, SessionRuntime<any>>()
    readonly keyed = new Map<string, SessionRuntime<any>>()
    readonly singletons = new Map<ProviderCacheKey, CacheSlot>()
    readonly singletonOwners = new Map<TokenLike, SessionRuntime<any>>()
    readonly singletonRegistrations = new Map<TokenLike, ProviderRegistration>()
    readonly pending = new Set<PendingRequest>()
    readonly suspendedOrder: string[] = []
    released = false

    private readonly sessionListeners = new Set<() => void>()
    private readonly detachProviderChange: () => void

    constructor(options: ApplicationOptions<THost, TTarget>) {
        const { ports, limits } = buildPorts(options)
        this.ports = ports
        this.limits = limits
        this.detachProviderChange = ports.host.scope.onProviderChange(() => {
            schedulePendingRetry(this)
        })
    }

    registerSession(session: SessionRuntime<any>): void {
        this.sessions.set(session.adapterHost, session)
        this.notifySessionsChanged()
    }

    unregisterSession(session: SessionRuntime<any>): void {
        if (this.sessions.get(session.adapterHost) === session) {
            this.sessions.delete(session.adapterHost)
        }
        this.notifySessionsChanged()
    }

    notifySessionsChanged(): void {
        for (const listener of [...this.sessionListeners]) {
            listener()
        }
    }

    onSessionsChanged(listener: () => void): () => void {
        this.sessionListeners.add(listener)
        return () => {
            this.sessionListeners.delete(listener)
        }
    }

    mount<S>(blueprint: Blueprint<S>, options?: MountOptions): (target: TTarget) => Session<S, THost> {
        return (target: TTarget): Session<S, THost> =>
            mountSession(this, blueprint, options, target) as unknown as Session<S, THost>
    }

    inject<T>(token: TokenLike<T>, options?: InjectOptions): (target: LateTarget<TTarget>) => Promise<T>
    inject<K extends string>(
        token: K,
        options?: InjectOptions,
    ): (target: LateTarget<TTarget>) => Promise<RegisteredService<K>>
    inject<T>(token: string, options?: InjectOptions): (target: LateTarget<TTarget>) => Promise<T>
    inject(
        token: TokenLike<any> | string,
        options?: InjectOptions,
    ): (target: LateTarget<TTarget>) => Promise<any> {
        return (target: LateTarget<TTarget>) =>
            injectToken(this, token as TokenLike<any>, options, target)
    }

    inject$<T>(token: TokenLike<T>, options?: InjectOptions): (target: LateTarget<TTarget>) => Observable<T>
    inject$<K extends string>(
        token: K,
        options?: InjectOptions,
    ): (target: LateTarget<TTarget>) => Observable<RegisteredService<K>>
    inject$<T>(token: string, options?: InjectOptions): (target: LateTarget<TTarget>) => Observable<T>
    inject$(
        token: TokenLike<any> | string,
        options?: InjectOptions,
    ): (target: LateTarget<TTarget>) => Observable<any> {
        return (target: LateTarget<TTarget>) => injectToken$(this, token as TokenLike<any>, options, target)
    }

    injectAll<T>(
        token: TokenLike<T>,
        options?: InjectAllOptions,
    ): (target: LateTarget<TTarget>) => Promise<T[]>
    injectAll<K extends string>(
        token: K,
        options?: InjectAllOptions,
    ): (target: LateTarget<TTarget>) => Promise<RegisteredService<K>[]>
    injectAll<T>(token: string, options?: InjectAllOptions): (target: LateTarget<TTarget>) => Promise<T[]>
    injectAll(
        token: TokenLike<any> | string,
        options?: InjectAllOptions,
    ): (target: LateTarget<TTarget>) => Promise<any[]> {
        return (target: LateTarget<TTarget>) =>
            injectAllTokens(this, token as TokenLike<any>, options, target)
    }

    injectAll$<T>(
        token: TokenLike<T>,
        options?: InjectAllOptions,
    ): (target: LateTarget<TTarget>) => Observable<T[]>
    injectAll$<K extends string>(
        token: K,
        options?: InjectAllOptions,
    ): (target: LateTarget<TTarget>) => Observable<RegisteredService<K>[]>
    injectAll$<T>(
        token: string,
        options?: InjectAllOptions,
    ): (target: LateTarget<TTarget>) => Observable<T[]>
    injectAll$(
        token: TokenLike<any> | string,
        options?: InjectAllOptions,
    ): (target: LateTarget<TTarget>) => Observable<any[]> {
        return (target: LateTarget<TTarget>) =>
            injectAllTokens$(this, token as TokenLike<any>, options, target)
    }

    read<S = any, R = any>(selector: (state: S) => R): (session: Session<S, any>) => R {
        return (session: Session<S, any>) => readState(this, session, selector)
    }

    update<S = any>(update: StateUpdate<S>): (session: Session<S, any>) => boolean {
        return (session: Session<S, any>) => updateState(this, session, update)
    }

    subscribe$<S>(listener: (state: S) => void): (session: Session<S, any>) => Subscription {
        return (session: Session<S, any>) => subscribeState(this, session, listener)
    }

    sessionAt(target: TTarget): Session<any, THost> | null {
        return sessionAt(this, target) as Session<any, THost> | null
    }

    session$(target: TTarget): Observable<Session<any, THost> | null> {
        return sessionStream(this, target) as Observable<Session<any, THost> | null>
    }

    dispose(session: Session<any, any>): void {
        disposeSession(this, session)
    }

    attach(config: AttachConfig): (session: Session<any, any>) => AttachHandle {
        return (session: Session<any, any>): AttachHandle => {
            const owned = assertOwnedSession(this, session)
            const { connectivity } = this.ports.host
            const unsubscribe = connectivity.subscribe(owned.adapterHost, (connected, adoptedDoc) => {
                if (adoptedDoc !== undefined) {
                    config.onAdopt?.(adoptedDoc)
                    if (!connected) {
                        config.onDisconnect?.()
                    }
                    return
                }
                if (connected) {
                    config.onConnect?.()
                } else {
                    config.onDisconnect?.()
                }
            })
            return {
                detach: unsubscribe,
            }
        }
    }

    release(): void {
        if (this.released) {
            return
        }
        this.released = true
        for (const session of [...this.sessions.values()]) {
            session.dispose('explicit')
        }
        for (const session of [...this.keyed.values()]) {
            session.dispose('explicit')
        }
        for (const request of [...this.pending]) {
            request.reject(
                new DocumentContextError(
                    'DISPOSED_SESSION',
                    'The application was released before the injection could finish.',
                ),
            )
        }
        this.sessions.clear()
        this.keyed.clear()
        this.singletons.clear()
        this.singletonOwners.clear()
        this.singletonRegistrations.clear()
        this.pending.clear()
        this.suspendedOrder.length = 0
        this.sessionListeners.clear()
        this.detachProviderChange()
    }
}

/**
 * Wire a set of ports into an application.
 *
 * @example
 * ```ts
 * import { createContext, createApplication } from '@sandlada/document-context'
 * import { createDomHostAdapter } from '@sandlada/document-context/infrastructure/dom'
 *
 * // Create custom isolated application instance
 * const app = createApplication({ host: createDomHostAdapter() })
 *
 * const blueprint = createContext({ isolated: true })
 * const host = document.getElementById('sandbox-root')!
 * const session = app.mount(blueprint)(host)
 * await session.ready
 *
 * const isIsolated = app.read((s: { isolated: boolean }) => s.isolated)(session)
 * console.log(isIsolated) // true
 * ```
 *
 * @param options - The host adapter, the optional SSR port and optional limits.
 * @returns The application.
 */
export function createApplication<THost extends Host = Host, TTarget = unknown>(
    options: ApplicationOptions<THost, TTarget>,
): Application<THost, TTarget> {
    return new ApplicationImpl<THost, TTarget>(options)
}
