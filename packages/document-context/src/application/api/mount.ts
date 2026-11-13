/**
 * `mount` — the Phase 2 entry point.
 *
 * `mount` is **synchronous**: it returns the session handle right away. `session.ready` reports
 * whether the initialization finished.
 */

import { DocumentContextError } from '../../domain/model/errors'
import { validateTokenName, type TokenLike } from '../../domain/model/token'
import type { Blueprint } from '../../domain/model/blueprint'
import type { Host, ServerHost, Session } from '../../domain/model/session'
import type { ApplicationRuntime } from '../context'
import { SessionRuntime } from '../session'
import { assertUsesResolvable, detectUsesCycle, resolveProviderValue } from '../resolver'
import { claimSingleton, isWinningSingleton } from '../scopes/lifecycle'
import { retryPendingRequests, schedulePendingRetry } from '../pending'
import {
    suspendSession,
    findSuspendedSession,
    findSuspendingSession,
    findUnconfirmedDisconnect,
    isSuspending,
    moveConnectedSession,
    resumeSession,
} from '../lifecycle/resume'
import { watchConnectivity } from '../lifecycle/disconnect'

/** Options of a single mount. */
export interface MountOptions {
    /** The keyed identity of the session. */
    readonly token?: string
    /** How long a suspended session may wait for resuscitation. Defaults to `5000`. */
    readonly suspensionTtlMs?: number
    /** `pinned` keeps the session alive regardless of TTL and suspension cap. */
    readonly retention?: 'default' | 'pinned'
    /** How to react to an identity conflict on the same host. Defaults to `throw`. */
    readonly onConflict?: 'throw' | 'replace' | 'reset'
    /** Cancels the mount while it is still `starting`. */
    readonly signal?: AbortSignal
}

const DEFAULT_SUSPENSION_TTL_MS = 5000

/**
 * Mount a blueprint on a host.
 *
 * @param runtime - The application runtime.
 * @param blueprint - The blueprint to mount.
 * @param options - The mount options.
 * @param target - The mount target: a connected element or a server placeholder host.
 * @returns The session handle.
 */
export function mountSession<S, TTarget = unknown>(
    runtime: ApplicationRuntime,
    blueprint: Blueprint<S>,
    options: MountOptions | undefined,
    target: TTarget,
): SessionRuntime<S> {
    if (runtime.released) {
        throw new DocumentContextError(
            'DISPOSED_SESSION',
            'The application was released and cannot mount new sessions.',
        )
    }
    const ttl = options?.suspensionTtlMs ?? DEFAULT_SUSPENSION_TTL_MS
    const retention = options?.retention ?? 'default'
    const onConflict = options?.onConflict ?? 'throw'
    if (ttl === Number.POSITIVE_INFINITY && retention !== 'pinned') {
        throw new DocumentContextError(
            'INVALID_OPTIONS',
            'suspensionTtlMs: Infinity requires retention: "pinned".',
        )
    }
    if (ttl < 0 || Number.isNaN(ttl)) {
        throw new DocumentContextError(
            'INVALID_OPTIONS',
            'suspensionTtlMs must be a non-negative number.',
        )
    }

    const host = resolveHost(runtime, target)
    if (!runtime.ports.host.connectivity.isConnected(host)) {
        throw new DocumentContextError(
            'UNCONNECTED_HOST',
            'The host is not connected to its environment.',
        )
    }

    const explicitToken = options?.token
    if (explicitToken !== undefined) {
        validateTokenName(explicitToken)
    }
    const existingToken = runtime.ports.host.tokens.read(host)
    if (existingToken !== null) {
        validateTokenName(existingToken)
    }
    let token = explicitToken ?? existingToken
    let seed = blueprint.state

    const occupying = runtime.sessions.get(host)
    const identityMismatch =
        explicitToken !== undefined && existingToken !== null && explicitToken !== existingToken
    // A suspended keyed session on this host is waiting to be mounted again. That is resuscitation,
    // including the same element reconnecting. An active session on this host is still a conflict.
    const restorable =
        occupying !== undefined &&
        occupying.token !== null &&
        occupying.token === token &&
        (occupying.status === 'suspended' || isSuspending(occupying))
    if ((occupying !== undefined && !restorable) || identityMismatch) {
        if (onConflict === 'throw') {
            throw new DocumentContextError(
                'KEYED_CONFLICT',
                occupying !== undefined
                    ? 'The host already carries a session.'
                    : 'The host carries a different keyed identity.',
                {
                    details: {
                        token: occupying?.token ?? existingToken,
                        requested: explicitToken ?? null,
                    },
                },
            )
        }
    }

    if (token !== null) {
        for (const session of runtime.sessions.values()) {
            if (session === occupying) {
                continue
            }
            if (isSuspending(session)) {
                continue
            }
            if (
                session.token === token &&
                (session.status === 'active' || session.status === 'starting') &&
                runtime.ports.host.connectivity.isConnected(session.adapterHost)
            ) {
                throw new DocumentContextError(
                    'KEYED_CONFLICT',
                    `The token "${token}" is already mounted on another connected host.`,
                    { details: { token } },
                )
            }
        }
    }

    if (occupying !== undefined && (onConflict === 'replace' || onConflict === 'reset')) {
        if (onConflict === 'reset') {
            seed = occupying.snapshot()
        }
        occupying.dispose('conflict')
        runtime.unregisterSession(occupying)
    }

    if (token !== null) {
        const suspendingSession = findSuspendingSession(runtime, token)
        if (suspendingSession !== undefined) {
            resumeSession(runtime, suspendingSession, host)
            return suspendingSession as SessionRuntime<S>
        }
        const unconfirmed = findUnconfirmedDisconnect(runtime, token)
        if (unconfirmed !== undefined) {
            moveConnectedSession(runtime, unconfirmed, host)
            return unconfirmed as SessionRuntime<S>
        }
        const suspended = findSuspendedSession(runtime, token)
        if (suspended !== undefined && suspended.status === 'suspended') {
            resumeSession(runtime, suspended, host)
            return suspended as SessionRuntime<S>
        }
    }

    const effectiveBlueprint: Blueprint<S> =
        seed === blueprint.state ? blueprint : Object.freeze({ ...blueprint, state: seed })

    const session = new SessionRuntime<S>(runtime, effectiveBlueprint, host, {
        token,
        suspensionTtlMs: ttl,
        pinned: retention === 'pinned',
    })
    runtime.registerSession(session)
    if (token !== null) {
        runtime.ports.host.tokens.write(host, token)
    }

    for (const registration of session.blueprint.providers) {
        if (registration.lifecycle !== 'singleton') {
            continue
        }
        if (!claimSingleton(runtime, session, registration)) {
            session.reportError(
                new DocumentContextError(
                    'SINGLETON_CONFLICT',
                    `The singleton "${tokenLabel(registration.token)}" was already registered.`,
                    { details: { token: tokenLabel(registration.token) } },
                ),
            )
        }
    }

    session.setConnectivityWatcher(watchConnectivity(runtime, session))
    attachMountSignal(runtime, session, options?.signal)
    void initializeSession(runtime, session)
    return session
}

function resolveHost(runtime: ApplicationRuntime, target: unknown): Host {
    if (isServerHost(target)) {
        const ssr = runtime.ports.ssr
        if (ssr === undefined) {
            throw new DocumentContextError(
                'HOST_INVALID',
                'This application cannot mount server hosts.',
            )
        }
        return runtime.ports.host.normalize(ssr.createHost())
    }
    return runtime.ports.host.normalize(target)
}

function isServerHost(target: unknown): target is ServerHost {
    return (
        typeof target === 'object' &&
        target !== null &&
        (target as { kind?: unknown }).kind === 'server'
    )
}

function attachMountSignal(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
    signal: AbortSignal | undefined,
): void {
    if (signal === undefined) {
        return
    }
    const abort = (): void => {
        if (session.status !== 'starting') {
            return
        }
        session.fail(signal.reason ?? new Error('The mount was aborted.'))
        session.dispose('explicit')
    }
    if (signal.aborted) {
        abort()
        return
    }
    signal.addEventListener('abort', abort, { once: true })
    session.onLeaveStarting(() => {
        signal.removeEventListener('abort', abort)
    })
}

async function initializeSession(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
): Promise<void> {
    try {
        // Yield once so that the updates queued right after `mount` land before the eager
        // dependencies are created. This is an ordering yield, not a time behaviour: every
        // time-dependent behaviour goes through the scheduler port.
        await Promise.resolve()
        if (session.isDisposed) {
            return
        }
        if (detectUsesCycle(session.blueprint.providers)) {
            throw new DocumentContextError(
                'CIRCULAR_DEPENDENCY',
                'The declared dependencies of this blueprint contain a cycle.',
            )
        }
        assertUsesResolvable(runtime, session)
        for (const registration of session.blueprint.providers) {
            if (!registration.eager || !isWinningSingleton(runtime, registration)) {
                continue
            }
            await resolveProviderValue(runtime, session, registration)
        }
        if (session.isDisposed) {
            return
        }
        const hostIsGone = (): boolean =>
            session.isDisconnected ||
            !runtime.ports.host.connectivity.isConnected(session.adapterHost)
        if (hostIsGone()) {
            finishWithoutActivation(runtime, session)
            return
        }
        if (session.adapterHost.kind !== 'server') {
            // The server has no DOM lifecycle: `onMount` only runs in the browser.
            await session.runMountHooks()
        }
        if (session.isDisposed) {
            return
        }
        if (hostIsGone()) {
            finishWithoutActivation(runtime, session)
            return
        }
        session.activate()
        session.markReady()
        schedulePendingRetry(runtime)
    } catch (error) {
        session.fail(error)
        session.dispose('explicit')
    }
}

/**
 * Finish the initialization of a session whose host is gone.
 *
 * A keyed session suspends and fulfils `ready`; an anonymous session is disposed and rejects
 * `ready` with `UNCONNECTED_HOST`.
 */
function finishWithoutActivation(
    runtime: ApplicationRuntime,
    session: SessionRuntime<any>,
): void {
    if (session.token !== null) {
        suspendSession(runtime, session)
        session.markReady()
    } else {
        session.dispose('disconnect')
    }
    schedulePendingRetry(runtime)
}

function tokenLabel(token: TokenLike): string {
    return typeof token === 'string' ? token : token.name
}
