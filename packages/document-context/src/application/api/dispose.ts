/**
 * Application dispose verb: two-phase session teardown.
 *
 * Phase one runs synchronously: the abort channel fires, the state store is
 * poisoned, host listeners and TTLs are torn down, synchronous `onMount`
 * cleanup closures run LIFO, then `onDispose` hooks run LIFO. Phase two is
 * fire-and-forget: async cleanups settle in the background, `errors$`
 * completes after settlement, and `[Symbol.asyncDispose]` awaits it.
 *
 * Every hook and cleanup is sandboxed into `HOOK_ERROR` on the session
 * `errors$` without interrupting the remaining teardown. Disposal is
 * idempotent: repeated calls and unknown sessions are silent no-ops.
 *
 * Portability rules match the mount verb: no DOM globals, no real timers,
 * only non-time RxJS cores, and runtime imports limited to the landed
 * domain. The context type enters type-only from `../context.js` (A3) and is
 * erased at runtime. This module shares live entries with the mount verb
 * through the global symbol registry and never runtime-imports sibling api
 * files.
 */

import type { Subscription } from 'rxjs'
import type { Subject } from 'rxjs'
import { DocumentContextError } from '../../domain/model/errors.js'
import { isThenable } from '../../domain/ports/scope-transport.js'
import type { ContextBlueprint } from '../../domain/model/blueprint.js'
import type { LifecycleEvent, Session } from '../../domain/model/session.js'
import type { MountSessionRecord } from '../../domain/usecases/mount.js'
import type { ApplicationContext } from '../context.js'

/** Slot sharing live entries with the mount verb through the global symbol registry. */
const ENTRY_SLOT = Symbol.for('document-context.application.session-entry')

/** Slot sharing the per-context suspended list with the mount verb. */
const SUSPENDED_SLOT = Symbol.for('document-context.application.suspended-list')

/** Buffered error channel view; owned and created by the mount verb. */
interface ErrorChannelView {
    /** True while pushes are accepted. */
    readonly open: boolean
    /** Buffers (pre-subscribe) or forwards an error. */
    push(error: DocumentContextError): void
    /** Completes the channel after settlement. */
    complete(): void
}

/** Live per-session bookkeeping view; the mount verb owns the full shape. */
interface SessionEntryView {
    /** Domain mount record; status is the lifecycle source of truth. */
    record: MountSessionRecord<Record<PropertyKey, unknown>>
    /** Mounted blueprint carrying `onDispose` hooks. */
    blueprint: ContextBlueprint<Record<PropertyKey, unknown>>
    /** Native node the session is currently bound to. */
    native: unknown
    /** Map key for the native node. */
    nativeKey: object
    /** Normalized keyed identity, or null for anonymous sessions. */
    token: string | null
    /** Buffered non-fatal error channel. */
    channel: ErrorChannelView
    /** Session lifecycle stream. */
    lifecycle: { next(event: LifecycleEvent): void, complete(): void }
    /** Synchronous `onMount` cleanup closures, consumed LIFO. */
    cleanups: Array<() => unknown>
    /** Domain kernel dispose driver; rejects pending inits with `DISPOSED_SESSION`. */
    kernel: { dispose(): void }
    /** `context-request` unsubscribe, or null before install and after teardown. */
    offRequest: (() => void) | null
    /** Host lifecycle subscription, or null after teardown. */
    hostSub: Subscription | null
    /** Facade lifecycle forwarding subscription, or null after teardown. */
    forwardSub: Subscription | null
    /** Pending TTL cancel, or null when none is armed. */
    ttlCancel: (() => void) | null
    /** Terminal dispose guard making disposal idempotent. */
    disposed: boolean
    /** Count of unsettled fire-and-forget async cleanups. */
    pendingAsync: number
    /** Resolver for the async settlement promise. */
    resolveSettled: () => void
}

/** Reads the live entry behind a facade, or undefined for foreign sessions. */
const readEntry = (facade: Session): SessionEntryView | undefined => {
    const slot = (facade as unknown as Record<symbol, unknown>)[ENTRY_SLOT]
    if (typeof slot !== 'object' || slot === null) {
        return undefined
    }
    return slot as SessionEntryView
}

/** Removes a facade from the per-context suspended list. */
const removeFromSuspended = (ctx: ApplicationContext, facade: Session): void => {
    const table = ctx as unknown as Record<symbol, unknown>
    const existing = table[SUSPENDED_SLOT]
    if (!Array.isArray(existing)) {
        return
    }
    const list = existing as Array<{ readonly facade: object }>
    const index = list.findIndex((slot) => slot.facade === (facade as unknown as object))
    if (index >= 0) {
        list.splice(index, 1)
    }
}

/** Settles one fire-and-forget async cleanup; completes errors at zero. */
const settleAsync = (entry: SessionEntryView): void => {
    entry.pendingAsync -= 1
    if (entry.pendingAsync === 0) {
        if (entry.disposed) {
            entry.channel.complete()
        }
        entry.resolveSettled()
    }
}

/** Tracks a fire-and-forget async cleanup; rejections route to errors$ when open else `reportError`. */
const trackAsync = (entry: SessionEntryView, produced: Promise<unknown>, hook: string): void => {
    entry.pendingAsync += 1
    produced.then(
        () => {
            settleAsync(entry)
        },
        (error: unknown) => {
            const failure = new DocumentContextError('HOOK_ERROR', { hook, error })
            if (entry.channel.open) {
                entry.channel.push(failure)
            } else if (typeof globalThis.reportError === 'function') {
                globalThis.reportError(failure)
            }
            settleAsync(entry)
        },
    )
}

/**
 * Tears down one session in two phases. Mirrors the mount-side `disposeEntry`;
 * keep the two in sync. Idempotent through the entry disposed guard. The
 * flush phase orders abort, persist write-back, then poison and teardown:
 * the abort controller fires first so cancellation settles, the duck-typed
 * persist wiring (set by the mount verb in phase 2) performs one
 * best-effort final flush, and only then does the kernel poison the store
 * while the teardown below releases listeners and cleanups.
 *
 * @param ctx Application context.
 * @param entry Live entry behind the facade.
 * @param facade Session facade to tear down.
 */
const disposeLive = (ctx: ApplicationContext, entry: SessionEntryView, facade: Session): void => {
    if (entry.disposed) {
        return
    }
    entry.disposed = true
    try {
        if (!entry.record.abortController.signal.aborted) {
            entry.record.abortController.abort()
        }
    } catch {
        // Abort is best-effort; teardown proceeds regardless.
    }
    const wiring = (entry as { readonly wiring?: { dispose(): unknown } }).wiring
    if (wiring !== undefined && wiring !== null) {
        try {
            const produced: unknown = wiring.dispose()
            if (isThenable(produced)) {
                Promise.resolve(produced).then(undefined, () => {})
            }
        } catch {
            // Persist flush is best-effort; teardown proceeds regardless.
        }
    }
    try {
        entry.kernel.dispose()
    } catch {
        // Kernel guards illegal transitions; application teardown proceeds regardless.
    }
    if (entry.offRequest !== null) {
        entry.offRequest()
        entry.offRequest = null
    }
    if (entry.hostSub !== null) {
        entry.hostSub.unsubscribe()
        entry.hostSub = null
    }
    if (entry.forwardSub !== null) {
        entry.forwardSub.unsubscribe()
        entry.forwardSub = null
    }
    if (entry.ttlCancel !== null) {
        entry.ttlCancel()
        entry.ttlCancel = null
    }
    removeFromSuspended(ctx, facade)
    while (entry.cleanups.length > 0) {
        const cleanup = entry.cleanups.pop()
        if (cleanup === undefined) {
            continue
        }
        try {
            const produced: unknown = cleanup()
            if (isThenable(produced)) {
                trackAsync(entry, Promise.resolve(produced), 'cleanup')
            }
        } catch (error) {
            entry.channel.push(new DocumentContextError('HOOK_ERROR', { hook: 'cleanup', error }))
        }
    }
    const disposers = entry.blueprint.hooks.filter((hook) => hook.event === 'dispose').reverse()
    for (const hook of disposers) {
        try {
            const produced: unknown = (hook.handler as unknown as (session: unknown) => unknown)(facade)
            if (isThenable(produced)) {
                trackAsync(entry, Promise.resolve(produced), 'dispose')
            }
        } catch (error) {
            entry.channel.push(new DocumentContextError('HOOK_ERROR', { hook: 'dispose', error }))
        }
    }
    ctx.sessions.delete(entry.nativeKey)
    if (entry.token !== null && ctx.keyed.get(entry.token) === (facade as Session)) {
        ctx.keyed.delete(entry.token)
    }
    ctx.records.delete(facade as unknown as object)
    if (entry.token !== null) {
        try {
            if (ctx.ports.host.tokens.read(entry.native) === entry.token) {
                ctx.ports.host.tokens.write(entry.native, null)
            }
        } catch {
            // Identity write-back is best-effort on teardown.
        }
    }
    entry.lifecycle.next({ type: 'disposed' })
    entry.lifecycle.complete()
    if (entry.pendingAsync === 0) {
        entry.channel.complete()
    }
    ctx.settled$.next()
}

/**
 * Creates the dispose verb over an application context.
 *
 * Disposal runs the two-phase teardown: abort fires, the persist wiring
 * flushes one best-effort write (when the mount verb wired one), the store
 * poisons,
 * listeners tear down, sync cleanups run LIFO before `onDispose` hooks LIFO,
 * async cleanups settle fire-and-forget, `errors$` completes after
 * settlement, `lifecycle$` pushes `disposed`, registries drop the session,
 * keyed identity write-back clears, and `settled$` pulses. Disposing an
 * initializing session rejects its mount with `DISPOSED_SESSION`.
 *
 * @param ctx Application context holding ports and registries.
 * @returns Data-last dispose: `(session) => void`, idempotent and silent for unknown sessions.
 * @example
 * ```ts
 * import { createDispose } from './dispose.js'
 *
 * const dispose = createDispose(ctx)
 * dispose(session)
 * dispose(session)
 * ```
 */
export function createDispose(ctx: ApplicationContext): (session: Session) => void {
    return (session: Session): void => {
        const entry = readEntry(session)
        if (entry === undefined) {
            return
        }
        disposeLive(ctx, entry, session)
    }
}
