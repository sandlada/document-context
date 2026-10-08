import { DocumentContextError } from './errors'
import { getInternalSession } from './session-internal'
import type { ISession } from './types'

/**
 * Host activation contract: `bind` attaches one host-scoped integration
 * (bridge engine, provider responder, GC tracking, ...) to the given element
 * and returns its cleanup.
 */
export interface IHostActivation {
    bind(target: HTMLElement): (() => void) | void
}

interface IHostActivationRecord {
    activation: IHostActivation
    cleanup: (() => void) | undefined
}

/**
 * Host-scoped activations per session, keyed weakly by the opaque session
 * handle. Kept separate from `internal.cleanups` so resuscitation can tear
 * down and rebind exactly the element-bound integrations without re-running
 * user `mount` hooks.
 */
const sessionActivations = new WeakMap<ISession<any, any>, IHostActivationRecord[]>()

function reportActivationError(session: ISession<any, any>, err: unknown): void {
    const internal = getInternalSession(session)
    internal?.errorSubject.next(
        new DocumentContextError({
            code: 'HOST_ACTIVATION_ERROR',
            message: err instanceof Error ? err.message : String(err),
            details: { error: String(err) }
        })
    )
}

/**
 * Registers one host activation and binds it immediately to the session's
 * current target. Called by `withBridge` (via its mount hook) and by the DOM
 * provider-responder plugin.
 *
 * Bind failures never propagate: they are routed to the session error stream
 * as `HOST_ACTIVATION_ERROR`.
 *
 * @param session - Live session owning the activation.
 * @param activation - Binder invoked now and on every resuscitation.
 * @returns `void`.
 */
export function registerHostActivation(
    session: ISession<any, any>,
    activation: IHostActivation
): void {
    let records = sessionActivations.get(session)
    if (!records) {
        records = []
        sessionActivations.set(session, records)
    }

    const record: IHostActivationRecord = { activation, cleanup: undefined }
    try {
        const cleanup = activation.bind(session.target)
        if (typeof cleanup === 'function') {
            record.cleanup = cleanup
        }
    } catch (err) {
        reportActivationError(session, err)
    }
    records.push(record)
}

/**
 * Tears down every registered activation's current binding and rebinds it to
 * the new host element (resuscitation step). Each cleanup runs before its
 * replacement bind; failures are sandboxed to the session error stream.
 *
 * @param session - Live session being resuscitated.
 * @param newTarget - Replacement host element.
 * @returns `void`.
 */
export function rebindHostActivations(
    session: ISession<any, any>,
    newTarget: HTMLElement
): void {
    const records = sessionActivations.get(session)
    if (!records) {
        return
    }

    for (const record of records) {
        if (record.cleanup) {
            try {
                record.cleanup()
            } catch (err) {
                reportActivationError(session, err)
            }
            record.cleanup = undefined
        }

        try {
            const cleanup = record.activation.bind(newTarget)
            if (typeof cleanup === 'function') {
                record.cleanup = cleanup
            }
        } catch (err) {
            reportActivationError(session, err)
        }
    }
}

/**
 * Tears down every registered activation in reverse registration order and
 * drops the records (called once by `dispose()`). Safe to call twice.
 *
 * @param session - Disposed session.
 * @returns `void`.
 */
export function teardownHostActivations(session: ISession<any, any>): void {
    const records = sessionActivations.get(session)
    if (!records) {
        return
    }
    sessionActivations.delete(session)

    for (let i = records.length - 1; i >= 0; i--) {
        const record = records[i]
        if (!record || !record.cleanup) {
            continue
        }
        try {
            record.cleanup()
        } catch (err) {
            reportActivationError(session, err)
        }
    }
}
