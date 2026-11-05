/**
 * Session and host vocabulary.
 *
 * The {@link Host} is the stable facade a session is bound to. It survives suspension and
 * resuscitation: after a keyed session resumes on a different element, `session.host` is still the
 * same object, but `native()` points at the new element.
 */

import type { Observable } from 'rxjs'
import type { DocumentContextError } from './errors'
import type { LifecycleEvent, SessionStatus } from './lifecycle'

/** Marker used to recognise a session without relying on `instanceof` across bundles. */
export const sessionBrand: unique symbol = Symbol('document-context.session')

/** Where a host lives. */
export type HostKind = 'element' | 'server'

/**
 * A DOM-like event delivered through {@link Host.on}.
 *
 * The domain layer never touches DOM globals, so the event shape is described structurally.
 */
export interface HostEvent {
    readonly type: string
    readonly target: unknown
    readonly currentTarget: unknown
    readonly defaultPrevented: boolean
    readonly detail?: unknown
    readonly [key: string]: unknown
}

/** Listener signature for {@link Host.on}. */
export type HostEventListener = (event: HostEvent) => void

/** Options accepted by {@link Host.on}. */
export interface HostListenerOptions {
    readonly signal?: AbortSignal
}

/**
 * The external face of the node a session is bound to.
 *
 * @typeParam TNative - The underlying platform object (`Element` in the browser).
 */
export interface Host<TNative = unknown> {
    /** Whether this host lives in an element-capable environment. */
    readonly kind: HostKind
    /** Whether the host is currently attached to its environment. */
    readonly isConnected: boolean
    /** The composed ancestor host, or `null` at the end of the chain. */
    readonly parent: Host | null
    /**
     * The underlying platform object.
     *
     * @throws When the host does not expose a native object (server hosts).
     */
    native(): TNative
    /**
     * Register a DOM listener on the current native object.
     *
     * @param type - The event type.
     * @param listener - The listener.
     * @param options - Listener options, including an optional `signal`.
     * @returns A function that removes the listener.
     */
    on(type: string, listener: HostEventListener, options?: HostListenerOptions): () => void
}

/**
 * A non-DOM placeholder host used by SSR.
 *
 * It has no parent chain, dispatches no events and exposes no native object.
 */
export interface ServerHost {
    readonly kind: 'server'
}

/** Everything `mount` accepts as its final argument in the browser. */
export type MountTarget = Element | ServerHost

/**
 * Everything `inject` accepts as its final argument.
 *
 * @typeParam TTarget - The raw element type of the host adapter.
 */
export type LateTarget<TTarget = Element> = TTarget | Session<any, any>

/**
 * The handle returned by `mount`.
 *
 * @typeParam S - The state shape.
 * @typeParam THost - The host flavour exposed by the owning adapter.
 */
export interface Session<S, THost extends Host = Host> {
    /** The stable host facade. */
    readonly host: THost
    /** The keyed identity of this session, or `null` for anonymous sessions. */
    readonly token: string | null
    /** The current lifecycle status. */
    readonly status: SessionStatus
    /** Resolves once initialization finished (or the session failed to initialize). */
    readonly ready: Promise<void>
    /** Hot stream of state snapshots; replays the current snapshot on subscribe. */
    readonly state$: Observable<S>
    /** Hot stream of non-fatal errors. */
    readonly errors$: Observable<DocumentContextError>
    /** Hot stream of lifecycle events; backs the current status on subscribe. */
    readonly lifecycle$: Observable<LifecycleEvent>
    /** Aborted when the session is disposed. Safe to hand to `fetch`. */
    readonly abortSignal: AbortSignal
    /**
     * Dispose the session and wait for the asynchronous cleanup to settle.
     *
     * @returns A promise that resolves when every cleanup settled.
     */
    [Symbol.asyncDispose](): Promise<void>
}

/**
 * Whether the given value is a session handle.
 *
 * @param value - The value to test.
 * @returns `true` when `value` carries the session brand.
 */
export function isSession(value: unknown): value is Session<any, any> {
    return (
        typeof value === 'object' &&
        value !== null &&
        sessionBrand in (value as Record<symbol, unknown>)
    )
}
