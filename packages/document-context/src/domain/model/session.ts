/**
 * Session handle model and the pure reactive state store behind `state$`.
 *
 * This module is pure: no DOM access, no timers, no I/O. It runs in a plain
 * Node environment. The `Session` handle is a branded type with no runtime
 * constructor; only `mount` (application layer) can produce one.
 * `createSessionState` is the tiny store primitive behind `state$` with
 * `BehaviorSubject` semantics: new subscribers immediately receive the
 * current snapshot, and every update publishes a new immutable snapshot.
 */
import type { Observable } from 'rxjs'
import { BehaviorSubject } from 'rxjs'
import type { DocumentContextError } from './errors.js'
import type { HostPort } from '../ports/host.js'

declare const SessionBrand: unique symbol

/**
 * Branded Session handle: a single mount handle whose fields are publicly
 * readable but never directly constructible. Handles are only obtained via
 * `mount`, which also owns the `host` facade, the abort wiring, and the
 * `Suspended` / `Disposed` transitions described in the domain model.
 *
 * @param S State shape; constrained to plain objects so `update` can
 * shallow-merge with object-spread semantics.
 * @param Host Native host type carried by the `HostPort` facade; the domain
 * keeps it generic while the public surface binds it to `HTMLElement`.
 */
export interface Session<S extends Record<PropertyKey, unknown> = Record<PropertyKey, unknown>, Host = unknown> {
    /** Brand marker proving the handle was issued by `mount`; not fabricable. */
    readonly [SessionBrand]: true
    /** Stable host facade: the reference never changes, resuscitation repoints it internally. */
    readonly host: HostPort<Host>
    /** Normalized keyed identity, or null for anonymous sessions. */
    readonly token: string | null
    /** Whether the current host is connected. */
    readonly isConnected: boolean
    /** Whether the session is parked in `Suspended` awaiting resuscitation. */
    readonly isSuspended: boolean
    /** Whether the session reached terminal `Disposed`. */
    readonly isDisposed: boolean
    /** Abort signal sharing its source with `abort$`; aborts on dispose. */
    readonly abortSignal: AbortSignal
    /** Hot state stream backed by the current snapshot. */
    readonly state$: Observable<S>
    /** Non-fatal error stream; fatal errors are thrown, never pushed here. */
    readonly errors$: Observable<DocumentContextError>
    /** Session lifecycle stream of `LifecycleEvent` values. */
    readonly lifecycle$: Observable<LifecycleEvent>
    /** Fires once, immediately, when the session is disposed. */
    readonly abort$: Observable<void>
    /** Optional Explicit Resource Management hook; absent without `ESNext.Disposable`. */
    readonly [Symbol.dispose]?: () => void
    /** Optional async Explicit Resource Management hook; absent without `ESNext.Disposable`. */
    readonly [Symbol.asyncDispose]?: () => Promise<void>
}

/**
 * Session lifecycle event union. `adopted` is the only variant carrying a
 * payload: the new owner supplied by `adoptNode`.
 */
export type LifecycleEvent =
    | { readonly type: 'mounted' }
    | { readonly type: 'suspended' }
    | { readonly type: 'resuscitated' }
    | { readonly type: 'adopted', readonly owner: unknown }
    | { readonly type: 'disposed' }

/**
 * Minimal pure store primitive behind `state$`. The store owns its snapshot,
 * replaces it (never mutates in place) on every change, and enters poisoned
 * protection once the session is disposed: updates report `false`, sets are
 * ignored, the snapshot stays frozen, and `state$` completes.
 */
export interface SessionState<S extends Record<PropertyKey, unknown>> {
    /** Hot stream replaying the current snapshot to every new subscriber. */
    readonly state$: Observable<S>
    /**
     * Reads the current snapshot.
     *
     * @returns The live snapshot reference; treat it as read-only.
     */
    getSnapshot(): S
    /**
     * Replaces the whole snapshot and pushes it to `state$`; ignored once poisoned.
     *
     * @param next The complete replacement snapshot.
     */
    setState(next: S): void
    /**
     * Shallow-merges a partial (or the result of an updater function) over the
     * previous snapshot with object-spread semantics: no deep merge, no key
     * deletion, prototype-safe `CreateDataProperty` writes.
     *
     * @param updater A partial state or a function mapping the previous snapshot to new or partial state.
     * @returns True when the merge was applied; false when the store is poisoned.
     */
    update(updater: Partial<S> | ((prev: S) => S | Partial<S>)): boolean
    /**
     * Enters poisoned protection and completes `state$`.
     */
    poison(): void
    /**
     * Reports whether the store is poisoned.
     *
     * @returns True once `poison` has run.
     */
    isPoisoned(): boolean
}

/**
 * Creates an isolated reactive state store seeded with a shallow copy of the
 * initial state. Pure factory: no DOM, no timers, no shared globals; every
 * call yields an independent store backed by its own `BehaviorSubject`.
 *
 * @param initial Seed snapshot; copied shallowly so later caller mutations cannot leak in.
 * @returns The new store handle.
 * @example
 * ```ts
 * import { createSessionState } from './session.js'
 *
 * const store = createSessionState({ count: 0 })
 * store.update({ count: 1 })
 * console.log(store.getSnapshot())
 * ```
 */
export function createSessionState<S extends Record<PropertyKey, unknown>>(initial: S): SessionState<S> {
    const subject = new BehaviorSubject<S>({ ...initial })
    let current: S = subject.value
    let poisoned = false

    return {
        state$: subject.asObservable(),
        getSnapshot(): S {
            return current
        },
        setState(next: S): void {
            if (poisoned) {
                return
            }
            current = { ...next }
            subject.next(current)
        },
        update(updater: Partial<S> | ((prev: S) => S | Partial<S>)): boolean {
            if (poisoned) {
                return false
            }
            const resolved: S | Partial<S> = typeof updater === 'function' ? updater(current) : updater
            current = { ...current, ...resolved }
            subject.next(current)
            return true
        },
        poison(): void {
            if (poisoned) {
                return
            }
            poisoned = true
            subject.complete()
        },
        isPoisoned(): boolean {
            return poisoned
        },
    }
}
