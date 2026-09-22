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
 * @property dirtyQueue - Updaters accumulated while suspended, replayed on
 * resuscitation.
 * @property sessionKey - Value of `data-context-key`, if present.
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
    dirtyQueue: Array<(state: S) => Partial<S> | S>
    sessionKey?: string | undefined
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
 * blueprint, creates the error replay subject, abort controller, and empty
 * caches, and captures the `data-context-key` session key when present.
 *
 * @param target - Host element being mounted.
 * @param blueprint - Originating blueprint supplying the seed state.
 * @returns A new `IInternalSessionState` with `isDisposed: false` and
 * `isSuspended: false`.
 */
export function createInternalSessionState<S extends Record<PropertyKey, any>>(
    target: HTMLElement,
    blueprint: IContextBlueprint<S, any>
): IInternalSessionState<S> {
    const sessionKey = target.getAttribute('data-context-key') ?? undefined
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
        dirtyQueue: [],
        sessionKey
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
 * Drops the element-to-session mapping (called once per `dispose()`).
 * The session handle itself stays usable for `isDisposed` checks; only the
 * reverse lookup is removed.
 *
 * @param element - Former host element.
 * @returns `void`.
 */
export function removeElementSession(element: HTMLElement): void {
    elementSessionMap.delete(element)
}
