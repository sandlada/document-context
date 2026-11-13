/**
 * The session runtime.
 *
 * A runtime session owns the state snapshot, the dependency caches, the streams, the hooks and the
 * lifecycle transitions. It is created by `mount` and disposed exactly once.
 */

import { DocumentContextError } from '../domain/model/errors'
import type { Blueprint, ProviderRegistration } from '../domain/model/blueprint'
import type { ProviderDeclaration } from '../domain/ports/scope-transport'
import { sessionBrand, type Host, type Session } from '../domain/model/session'
import type { DisposalReason, LifecycleEvent, SessionStatus } from '../domain/model/lifecycle'
import type { TokenLike } from '../domain/model/token'
import type { Observable } from 'rxjs'
import { createStateStream, type StateStream } from './streams/state'
import { createErrorStream, type ErrorStream } from './streams/errors'
import { createLifecycleStream, type LifecycleStream } from './streams/lifecycle'
import { runCleanups, runDisposeHooks, runHooks } from './lifecycle/hooks'
import { createRequestHandler } from './resolver'
import { releaseSingletons } from './scopes/lifecycle'
import type { ApplicationRuntime, CacheSlot, ProviderCacheKey } from './context'

/** Mount options that the session needs to remember. */
export interface SessionRuntimeOptions {
    /** The keyed identity of the session, or `null` for anonymous sessions. */
    readonly token: string | null
    /** How long a suspended session may wait for resuscitation. */
    readonly suspensionTtlMs: number
    /** Whether the session is pinned: immune to TTL and to the suspension cap. */
    readonly pinned: boolean
}

/**
 * The internal session object.
 *
 * It implements the public {@link Session} contract and adds the machinery the runtime needs.
 */
export class SessionRuntime<S = any> implements Session<S, Host> {
    /** The blueprint this session was mounted from. */
    readonly blueprint: Blueprint<S>
    /** Aborts when the session is disposed. */
    readonly abortController = new AbortController()
    /** `scoped` dependency cache. */
    readonly scopedCache = new Map<ProviderCacheKey, CacheSlot>()
    /** Registrations whose factory is currently running. Used to detect dependency cycles. */
    readonly resolving = new Set<ProviderRegistration>()
    /**
     * How many factories of a registration are running.
     *
     * Transient and prototype factories may overlap. The set above stays occupied until the last
     * one finishes, so a later call can still tell a cycle from a second injection.
     */
    readonly resolvingDepth = new Map<ProviderRegistration, number>()
    /**
     * Values of `uses` dependencies, created once per registration.
     *
     * Transient factories run again on every injection, but their declared dependencies do not.
     */
    readonly usedValues = new Map<ProviderRegistration, ReadonlyMap<TokenLike, unknown>>()
    /**
     * In-flight `uses` resolution for a registration.
     *
     * Published before the first await so an overlapping injection shares one creation.
     */
    readonly pendingUses = new Map<ProviderRegistration, Promise<ReadonlyMap<TokenLike, unknown>>>()
    /** Cleanup callbacks returned by `onMount` hooks. */
    readonly cleanups: (() => void)[] = []
    /** Promises returned by disposal hooks. */
    readonly pendingCleanups: Promise<unknown>[] = []

    private readonly runtime: ApplicationRuntime
    private readonly hostFacade: Host
    private rawHost: Host
    private currentStatus: SessionStatus = 'starting'
    private readonly tokenName: string | null
    /** How long a suspended session may wait for resuscitation. */
    readonly suspensionTtlMs: number
    /** Whether the session is immune to TTL expiry and to the suspension cap. */
    readonly pinned: boolean
    private readonly stateStream: StateStream<S>
    private readonly errorStream: ErrorStream
    private readonly lifecycleStream: LifecycleStream
    private readonly readyPromise: Promise<void>
    private settleReady: (() => void) | null = null
    private failReady: ((error: unknown) => void) | null = null
    private disposed = false
    private disconnected = false
    private mountHooksRan = false
    private ttlCancel: (() => void) | null = null
    private detachConnectivity: (() => void) | null = null
    private detachRequestHandler: (() => void) | null = null
    private readonly leaveStartingCleanups: (() => void)[] = []

    constructor(
        runtime: ApplicationRuntime,
        blueprint: Blueprint<S>,
        rawHost: Host,
        options: SessionRuntimeOptions,
    ) {
        this.runtime = runtime
        this.blueprint = blueprint
        this.rawHost = rawHost
        this.tokenName = options.token
        this.suspensionTtlMs = options.suspensionTtlMs
        this.pinned = options.pinned
        this.stateStream = createStateStream(blueprint.state)
        this.errorStream = createErrorStream()
        this.lifecycleStream = createLifecycleStream()
        this.readyPromise = new Promise<void>((resolve, reject) => {
            this.settleReady = resolve
            this.failReady = reject
        })
        // Never surface an unhandled rejection when nobody awaits `ready`.
        this.readyPromise.catch(() => undefined)

        const self = this
        this.hostFacade = {
            kind: rawHost.kind,
            get isConnected(): boolean {
                return self.rawHost.isConnected
            },
            get parent(): Host | null {
                return self.rawHost.parent
            },
            native: () => self.rawHost.native(),
            on: (type, listener, options) => self.rawHost.on(type, listener, options),
        }
    }

    /** The public session handle. */
    get session(): Session<S, Host> {
        return this
    }

    /** The stable host facade. */
    get host(): Host {
        return this.hostFacade
    }

    /** The adapter host the session is currently bound to. */
    get adapterHost(): Host {
        return this.rawHost
    }

    /** The application runtime that owns this session. */
    get owner(): ApplicationRuntime {
        return this.runtime
    }

    /** The keyed identity, or `null`. */
    get token(): string | null {
        return this.tokenName
    }

    /** The current status. */
    get status(): SessionStatus {
        return this.currentStatus
    }

    /** Resolves once initialization finished. */
    get ready(): Promise<void> {
        return this.readyPromise
    }

    /** The state stream. */
    get state$(): Observable<S> {
        return this.stateStream.observable
    }

    /** The error stream. */
    get errors$(): Observable<DocumentContextError> {
        return this.errorStream.observable
    }

    /** The lifecycle stream. */
    get lifecycle$(): Observable<LifecycleEvent> {
        return this.lifecycleStream.observable
    }

    /** The abort signal of this session. */
    get abortSignal(): AbortSignal {
        return this.abortController.signal
    }

    /** The marker that identifies this object as a session. */
    readonly [sessionBrand] = true

    /** The current state snapshot. */
    snapshot(): S {
        return this.stateStream.current()
    }

    /**
     * Apply an update.
     *
     * During `starting` the update is applied immediately: the seed already landed when the
     * session was mounted, so the new snapshot is ordered after the seed and before the eager
     * dependencies.
     *
     * @param updater - The updater. Must be synchronous.
     * @returns `false` when the session is disposed, `true` otherwise.
     */
    update(updater: (state: S) => S): boolean {
        if (this.disposed) {
            return false
        }
        this.applyUpdate(updater)
        return true
    }

    /**
     * Apply an update immediately, bypassing the `starting` queue.
     *
     * @param updater - The updater.
     */
    applyUpdate(updater: (state: S) => S): void {
        const next = updater(this.stateStream.current())
        this.stateStream.push(next)
    }

    /** Push a non-fatal error into `errors$`. */
    reportError(error: DocumentContextError): void {
        this.errorStream.push(error)
    }

    /**
     * Run the `onMount` hooks once.
     *
     * @returns A promise that settles when every hook settled.
     */
    async runMountHooks(): Promise<void> {
        if (this.mountHooksRan) {
            return
        }
        this.mountHooksRan = true
        await runHooks(this, 'mount')
    }

    /**
     * Run skipped `onMount` hooks at most once.
     *
     * Synchronous hooks finish before this returns. A returned promise is awaited before the next
     * hook starts, so the hooks stay in registration order. The resolved value is not a cleanup.
     *
     * @returns A promise when a hook returned one. `undefined` when every hook has already
     * finished.
     * @throws The synchronous error from a hook. The caller disposes the session without `active`.
     */
    runMountHooksSync(): Promise<void> | undefined {
        if (this.mountHooksRan) {
            return undefined
        }
        this.mountHooksRan = true
        const hooks = this.blueprint.hooks.filter((hook) => hook.type === 'mount')
        const runFrom = (index: number): Promise<void> | undefined => {
            for (let cursor = index; cursor < hooks.length; cursor += 1) {
                if (this.isDisposed) {
                    return undefined
                }
                const result = hooks[cursor]?.hook(this)
                if (typeof result === 'function') {
                    this.cleanups.push(result)
                    continue
                }
                if (result instanceof Promise) {
                    return result.then(() => (this.isDisposed ? undefined : runFrom(cursor + 1)))
                }
            }
            return undefined
        }
        return runFrom(0)
    }

    /** Whether the `onMount` hooks already ran. */
    get didRunMountHooks(): boolean {
        return this.mountHooksRan
    }

    /**
     * Run the `onSuspend` hooks.
     *
     * @returns A promise that settles when every hook settled.
     */
    async runSuspendHooks(): Promise<void> {
        await runHooks(this, 'suspend')
    }

    /**
     * Run the `onResume` hooks.
     *
     * @returns A promise that settles when every hook settled.
     */
    async runResumeHooks(): Promise<void> {
        await runHooks(this, 'resume')
    }

    /**
     * Run the `onAdopt` hooks.
     *
     * @returns A promise that settles when every hook settled.
     */
    async runAdoptHooks(): Promise<void> {
        if (this.currentStatus !== 'active') {
            return
        }
        this.lifecycleStream.transition({ type: 'active' }, { type: 'adopted' })
        await runHooks(this, 'adopt')
    }

    /**
     * Mark the session as ready.
     */
    markReady(): void {
        this.settleReady?.()
        this.settleReady = null
        this.failReady = null
    }

    /**
     * Fail the session.
     *
     * @param error - The reason the initialization failed.
     */
    fail(error: unknown): void {
        this.failReady?.(error)
        this.failReady = null
        this.settleReady = null
    }

    /**
     * Remember that the host was confirmed disconnected during initialization.
     */
    markDisconnected(): void {
        this.disconnected = true
    }

    /** The session is on a connected host again, so the old disconnect no longer applies. */
    clearDisconnected(): void {
        this.disconnected = false
    }

    /** Whether the host was confirmed disconnected during initialization. */
    get isDisconnected(): boolean {
        return this.disconnected
    }

    /**
     * Bind the session to a different host (keyed resuscitation).
     *
     * @param host - The new adapter host.
     */
    rebind(host: Host): void {
        this.rawHost = host
    }

    /**
     * The provider declarations of this session for the Context Protocol bus.
     *
     * @returns The declarations.
     */
    declarations(): readonly ProviderDeclaration[] {
        return this.blueprint.providers.map((registration) => ({
            token: registration.token,
            owner: this.runtime,
            multi: registration.multi,
        }))
    }

    /**
     * Make the session answer `context-request` events.
     */
    attachContextRequest(): void {
        this.detachContextRequest()
        this.detachRequestHandler = this.runtime.ports.host.scope.onRequest(
            this.rawHost,
            createRequestHandler(this.runtime, this),
        )
    }

    /**
     * Stop answering `context-request` events.
     */
    detachContextRequest(): void {
        this.detachRequestHandler?.()
        this.detachRequestHandler = null
    }

    /**
     * Move the session to `suspended`.
     */
    markSuspended(): void {
        if (this.currentStatus !== 'active' && this.currentStatus !== 'starting') {
            return
        }
        this.currentStatus = 'suspended'
        this.runLeaveStartingCleanups()
        this.lifecycleStream.transition({ type: 'suspended' }, { type: 'suspended' })
    }

    /**
     * Move the session to `active` and announce it on the Context Protocol bus.
     *
     * @param resumed - Whether the session resumes from a suspension.
     */
    activate(resumed = false): void {
        this.currentStatus = 'active'
        this.runLeaveStartingCleanups()
        this.lifecycleStream.transition(
            { type: 'active' },
            resumed ? { type: 'resumed' } : { type: 'active' },
        )
        const scope = this.runtime.ports.host.scope
        scope.declare(this.rawHost, this.declarations())
        this.attachContextRequest()
        scope.announce(this.rawHost, 'mount', this.tokenName)
        this.runtime.notifySessionsChanged()
    }

    /**
     * Remember the cancellation handle of the suspension timer.
     *
     * @param cancel - The cancellation handle.
     */
    setSuspensionTimer(cancel: () => void): void {
        this.ttlCancel?.()
        this.ttlCancel = cancel
    }

    /**
     * Remember the cancellation handle of the connectivity watcher.
     *
     * @param cancel - The cancellation handle.
     */
    setConnectivityWatcher(cancel: () => void): void {
        this.detachConnectivity?.()
        this.detachConnectivity = cancel
    }

    /**
     * Register a cleanup that runs when the session leaves the `starting` status.
     *
     * @param cleanup - The cleanup callback.
     */
    onLeaveStarting(cleanup: () => void): void {
        this.leaveStartingCleanups.push(cleanup)
    }

    private runLeaveStartingCleanups(): void {
        for (const cleanup of this.leaveStartingCleanups.splice(0)) {
            cleanup()
        }
    }

    /** Whether the session was disposed. */
    get isDisposed(): boolean {
        return this.disposed
    }

    /**
     * Dispose the session.
     *
     * @param reason - Why the session is disposed.
     */
    dispose(reason: DisposalReason): void {
        if (this.disposed) {
            return
        }
        const wasStarting = this.currentStatus === 'starting'
        this.disposed = true
        this.currentStatus = 'disposed'
        this.runLeaveStartingCleanups()
        if (wasStarting) {
            this.fail(
                reason === 'disconnect'
                    ? new DocumentContextError(
                          'UNCONNECTED_HOST',
                          'The host was disconnected while the session was initializing.',
                      )
                    : new DocumentContextError(
                          'DISPOSED_SESSION',
                          'The session was disposed while it was initializing.',
                      ),
            )
        }
        this.abortController.abort(
            new DocumentContextError('DISPOSED_SESSION', 'The session was disposed.'),
        )
        this.ttlCancel?.()
        this.ttlCancel = null
        this.detachConnectivity?.()
        this.detachConnectivity = null
        this.detachContextRequest()

        const scope = this.runtime.ports.host.scope
        scope.undeclare(this.rawHost)
        scope.announce(this.rawHost, 'dispose', this.tokenName)

        this.runtime.unregisterSession(this)
        releaseSingletons(this.runtime, this)
        if (this.tokenName !== null) {
            this.runtime.keyed.delete(this.tokenName)
            for (let index = this.runtime.suspendedOrder.length - 1; index >= 0; index -= 1) {
                if (this.runtime.suspendedOrder[index] === this.tokenName) {
                    this.runtime.suspendedOrder.splice(index, 1)
                }
            }
            this.runtime.ports.host.tokens.remove(this.rawHost, this.tokenName)
        }

        // Cleanups first (LIFO), then the dispose hooks (LIFO).
        runCleanups(this)
        runDisposeHooks(this)

        this.stateStream.complete()
        this.lifecycleStream.transition(
            { type: 'disposed', reason },
            { type: 'disposed', reason },
        )
        this.lifecycleStream.complete()

        if (this.pendingCleanups.length === 0) {
            this.errorStream.complete()
        } else {
            void Promise.allSettled(this.pendingCleanups).then(() => {
                this.errorStream.complete()
            })
        }

        this.runtime.notifySessionsChanged()
    }

    /**
     * Wait for the asynchronous cleanup of this session to settle.
     */
    async waitForCleanup(): Promise<void> {
        await Promise.allSettled(this.pendingCleanups)
    }

    /**
     * Register the disposal hook of this session with the runtime.
     */
    [Symbol.asyncDispose](): Promise<void> {
        this.dispose('explicit')
        return this.waitForCleanup()
    }

    /**
     * The provider registrations of this session for a token, last registration first.
     *
     * @param token - The token.
     * @returns The matching registrations in blueprint order.
     */
    registrationsFor(token: TokenLike): readonly ProviderRegistration[] {
        return this.blueprint.providers.filter(
            (registration) => registration.token === token,
        )
    }
}
