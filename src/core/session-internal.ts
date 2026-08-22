import { BehaviorSubject, ReplaySubject } from 'rxjs'
import type { DocumentContextError } from './errors'
import type { IContextBlueprint, ISession, ServiceToken } from './types'

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

export function getInternalSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    session: ISession<S, any>
): IInternalSessionState<S> | undefined {
    return sessionInternalMap.get(session)
}

export function setInternalSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    session: ISession<S, any>,
    state: IInternalSessionState<S>
): void {
    sessionInternalMap.set(session, state)
}

export function getElementSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    element: HTMLElement
): ISession<S, any> | undefined {
    return elementSessionMap.get(element)
}

export function setElementSession<S extends Record<PropertyKey, any> = Record<PropertyKey, any>>(
    element: HTMLElement,
    session: ISession<S, any>
): void {
    elementSessionMap.set(element, session)
}

export function removeElementSession(element: HTMLElement): void {
    elementSessionMap.delete(element)
}
