import { BehaviorSubject, ReplaySubject } from 'rxjs'
import type { DocumentContextError } from './errors'
import type { IContextBlueprint, ISession, ServiceToken } from './types'

/**
 * Mutable runtime internals for one live session, held in a WeakMap keyed by
 * the opaque `ISession` handle (never exposed publicly).
 *
 * @property stateSubject - `BehaviorSubject` holding the current immutable
 * state; seeded from `blueprint.initialState` (post-hydration).
 * @property errorSubject - `ReplaySubject(20)` collecting non-fatal runtime
 * errors; observed via `readErrorStream()`.
 * @property abortController - Aborted on `dispose()`; its signal is surfaced
 * as `session.abortSignal`.
 * @property cleanups - Mount/plugin/hook cleanups executed LIFO at dispose.
 * @property scopedServices - Cache for `'scoped'` lifecycle instances.
 * @property inFlightAsyncServices - Coalesced in-flight async factories.
 * @property isDisposed - Permanent terminal flag.
 * @property isSuspended - Parked-in-TTL flag for keyed sessions.
 * @property target - Current host element (repointed on resuscitation).
 * @property key - Resolved identity key for keyed sessions, `undefined` for
 * anonymous sessions. Cleared by `unregisterKeyedSession()`.
 * @property suspensionTtlMs - Grace period in milliseconds applied when the
 * host disconnects; `0` disposes immediately and `Infinity` never
 * auto-disposes. Resolved from `IMountOptions.suspensionTtlMs` (default 50).
 * @property suspensionTimer - Pending TTL timer handle while suspended.
 */
export interface IInternalSessionState<S extends Record<PropertyKey, any> = Record<PropertyKey, any>> {
    stateSubject: BehaviorSubject<S>
    errorSubject: ReplaySubject<DocumentContextError>
    abortController: AbortController
    cleanups: Array<() => void | Promise<void>>
    scopedServices: Map<string | ServiceToken<any>, any>
    inFlightAsyncServices: Map<string | ServiceToken<any>, Promise<any>>
    isDisposed: boolean
    isSuspended: boolean
    target: HTMLElement
    key?: string | undefined
    suspensionTtlMs: number
    suspensionTimer?: ReturnType<typeof setTimeout> | undefined
}

const sessionInternalMap = new WeakMap<ISession<any, any>, IInternalSessionState<any>>()
const elementSessionMap = new WeakMap<HTMLElement, ISession<any, any>>()

/**
 * Reports whether the current build is a development build.
 *
 * Returns `false` only when `globalThis.process.env.NODE_ENV` is exactly
 * `'production'`; every other environment (including browsers without
 * `process`) counts as development and enables freezing and extra checks.
 * Never throws; sandbox failures also yield `false`.
 *
 * @returns `true` in development, `false` in production.
 */
export function isDev(): boolean {
    try {
        return (
            typeof globalThis !== 'undefined' &&
            (globalThis as any).process?.env?.NODE_ENV !== 'production'
        )
    } catch {
        return false
    }
}

/**
 * Allocates fresh internals for a mount: seeds the state subject from the
 * blueprint, creates the error replay subject, abort controller, empty caches,
 * and captures the resolved session key plus the suspension TTL.
 *
 * @param target - Host element being mounted.
 * @param blueprint - Originating blueprint supplying the seed state.
 * @param key - Resolved identity key from `resolveSessionKey()`, if any.
 * @param suspensionTtlMs - Resolved grace period in milliseconds; defaults to
 * the library default of 50.
 * @returns A new `IInternalSessionState` with `isDisposed: false` and
 * `isSuspended: false`.
 */
export function createInternalSessionState<S extends Record<PropertyKey, any>>(
    target: HTMLElement,
    blueprint: IContextBlueprint<S, any>,
    key?: string | undefined,
    suspensionTtlMs: number = 50
): IInternalSessionState<S> {
    return {
        stateSubject: new BehaviorSubject<S>(blueprint.initialState),
        errorSubject: new ReplaySubject<DocumentContextError>(20),
        abortController: new AbortController(),
        cleanups: [],
        scopedServices: new Map(),
        inFlightAsyncServices: new Map(),
        isDisposed: false,
        isSuspended: false,
        target,
        key,
        suspensionTtlMs,
        suspensionTimer: undefined
    }
}

/**
 * Returns the internals for a session handle, or `undefined` when the session
 * was never mounted through this runtime (or its entry was collected).
 *
 * @param session - Opaque session handle.
 * @returns The internal state, or `undefined`.
 */
export function getInternalSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    session: ISession<S, any>
): IInternalSessionState<S> | undefined {
    return sessionInternalMap.get(session)
}

/**
 * Associates internals with a session handle (called once per `mount()`).
 *
 * @param session - Opaque session handle.
 * @param state - Internals created by `createInternalSessionState()`.
 * @returns `void`.
 */
export function setInternalSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    session: ISession<S, any>,
    state: IInternalSessionState<S>
): void {
    sessionInternalMap.set(session, state)
}

/**
 * Returns the live session cached for a host element, if any.
 *
 * @param element - Host element to look up.
 * @returns The cached `ISession`, or `undefined` when the element was never
 * mounted or was already disposed and unmapped.
 */
export function getElementSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    element: HTMLElement
): ISession<S, any> | undefined {
    return elementSessionMap.get(element)
}

/**
 * Caches a session handle under its host element (called once per `mount()`,
 * re-pointed on resuscitation).
 *
 * @param element - Host element.
 * @param session - Live session to associate.
 * @returns `void`.
 */
export function setElementSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    element: HTMLElement,
    session: ISession<S, any>
): void {
    elementSessionMap.set(element, session)
}

/**
 * Drops the element-to-session mapping (called on `dispose()` and when a keyed
 * session is parked into the suspended state).
 * The session handle itself stays usable for `isDisposed` checks; only the
 * reverse lookup is removed.
 *
 * @param element - Former host element.
 * @returns `void`.
 */
export function removeElementSession(element: HTMLElement): void {
    elementSessionMap.delete(element)
}
