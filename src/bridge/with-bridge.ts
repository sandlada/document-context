import { update } from '../core/update'
import { getInternalSession } from '../core/session-internal'
import type {
    IBridgeOptions,
    IBridgePropertyRule,
    IContextBlueprint,
    ISession
} from '../core/types'
import {
    isInternalWrite,
    safeWriteValueWithCursor,
    writeWithTransaction
} from './loop-guard'
import { readDomProperty, writeDomProperty } from './property-path'

/**
 * Pure blueprint operator to register bidirectional DOM property bridge options.
 *
 * @param options Bridge configuration options.
 * @returns A higher-order blueprint transformer function.
 */
export function withBridge<S extends Record<PropertyKey, any> = Record<PropertyKey, any>, Services = {}>(
    options: IBridgeOptions<S>
): <ActualState extends S, ActualServices extends Services>(
    blueprint: IContextBlueprint<ActualState, ActualServices>
) => IContextBlueprint<ActualState, ActualServices> {
    return (blueprint) => ({
        ...blueprint,
        bridges: [...blueprint.bridges, options as IBridgeOptions<any>]
    })
}

/**
 * Activates the bidirectional bridge on a mounted host element.
 *
 * @param element The host HTMLElement.
 * @param session The active ISession.
 * @param bridgeOptions The bridge options.
 * @returns Cleanup function.
 */
export function setupBridge<S extends Record<PropertyKey, any>>(
    element: HTMLElement,
    session: ISession<S, any>,
    bridgeOptions: IBridgeOptions<S>
): () => void {
    const internal = getInternalSession(session)
    if (!internal) {
        return () => {}
    }

    const events = bridgeOptions.events ?? ['input', 'change']

    // 1. Initial State -> DOM Sync
    const initialState = internal.stateSubject.getValue()
    writeWithTransaction(element, () => {
        for (const [key, rule] of Object.entries(bridgeOptions.properties)) {
            if (!rule) continue
            const targetPath = typeof rule === 'string' ? rule : (rule as IBridgePropertyRule<S>).target
            const transform = typeof rule === 'object' ? (rule as IBridgePropertyRule<S>).transform : undefined
            const rawVal = (initialState as any)[key]
            const val = transform ? transform(rawVal) : rawVal

            if (targetPath === 'value' && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
                safeWriteValueWithCursor(element, val === null || val === undefined ? '' : String(val))
            } else {
                writeDomProperty(element, targetPath, val)
            }
        }
    })

    // 2. Reactive JS State -> DOM Sync
    let isScheduled = false
    let pendingState: S | null = null

    const flushDomWrite = (state: S) => {
        writeWithTransaction(element, () => {
            for (const [key, rule] of Object.entries(bridgeOptions.properties)) {
                if (!rule) continue
                const targetPath = typeof rule === 'string' ? rule : (rule as IBridgePropertyRule<S>).target
                const transform = typeof rule === 'object' ? (rule as IBridgePropertyRule<S>).transform : undefined
                const rawVal = (state as any)[key]
                const val = transform ? transform(rawVal) : rawVal

                if (targetPath === 'value' && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
                    safeWriteValueWithCursor(element, val === null || val === undefined ? '' : String(val))
                } else {
                    writeDomProperty(element, targetPath, val)
                }
            }
        })
    }

    const sub = internal.stateSubject.subscribe((state) => {
        if (bridgeOptions.batch !== false) {
            pendingState = state
            if (!isScheduled) {
                isScheduled = true
                queueMicrotask(() => {
                    isScheduled = false
                    if (pendingState && !session.isDisposed) {
                        flushDomWrite(pendingState)
                    }
                })
            }
        } else {
            flushDomWrite(state)
        }
    })

    // 3. DOM Events -> JS State Sync
    const domEventListener = (_e: Event) => {
        if (isInternalWrite(element) || session.isDisposed) {
            return
        }

        const currentState = internal.stateSubject.getValue()
        const partialUpdate: Record<string, any> = {}
        let hasChanges = false

        for (const [key, rule] of Object.entries(bridgeOptions.properties)) {
            if (!rule) continue
            const targetPath = typeof rule === 'string' ? rule : (rule as IBridgePropertyRule<S>).target
            const parse = typeof rule === 'object' ? (rule as IBridgePropertyRule<S>).parse : undefined
            const rawVal = readDomProperty(element, targetPath)
            const finalVal = parse ? parse(rawVal) : rawVal

            const currentVal = (currentState as any)[key]
            if (!Object.is(currentVal, finalVal)) {
                partialUpdate[key] = finalVal
                hasChanges = true
            }
        }

        if (hasChanges) {
            update(partialUpdate)(session)
        }
    }

    for (const evt of events) {
        element.addEventListener(evt, domEventListener)
    }

    return () => {
        sub.unsubscribe()
        for (const evt of events) {
            element.removeEventListener(evt, domEventListener)
        }
    }
}
