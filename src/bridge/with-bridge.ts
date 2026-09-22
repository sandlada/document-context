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
 * Pure Phase 1 operator that registers one bidirectional DOM bridge.
 *
 * Appends `options` to `blueprint.bridges` and adds a `mount` hook that calls
 * `setupBridge(session.target, session, options)` at mount time. Multiple
 * `withBridge()` calls accumulate in order; each activates its own
 * subscription and listeners. The operator itself is side-effect free.
 *
 * @param options - Bridge bindings; see {@link IBridgeOptions}. Only listed
 * state keys synchronize; `events` defaults to `['input', 'change']` and
 * `batch` defaults to microtask coalescing.
 * @returns A blueprint transformer preserving state and service types.
 *
 * @example
 * ```ts
 * import { withBridge, parseNumber } from '@sandlada/document-context'
 *
 * const blueprint = pipe(
 *     createContext({ count: 0, query: '' }),
 *     withBridge({
 *         properties: {
 *             count: { target: 'dataset.count', parse: parseNumber },
 *             query: 'value'
 *         },
 *         events: ['input']
 *     })
 * )
 * ```
 */
export function withBridge<S extends Record<PropertyKey, any> = Record<PropertyKey, any>, Services = {}>(
    options: IBridgeOptions<S>
): <ActualState extends S, ActualServices extends Services>(
    blueprint: IContextBlueprint<ActualState, ActualServices>
) => IContextBlueprint<ActualState, ActualServices> {
    return (blueprint) => ({
        ...blueprint,
        bridges: [...blueprint.bridges, options as IBridgeOptions<any>],
        hooks: [
            ...blueprint.hooks,
            {
                event: 'mount',
                handler: (session: ISession<any, any>) =>
                    setupBridge(session.target, session, options as IBridgeOptions<any>)
            }
        ]
    })
}

/**
 * Activates one bidirectional bridge on an already-mounted host element.
 *
 * Normally invoked by the `withBridge` mount hook, not by hand. The pipeline
 * is: initial state-to-DOM sync inside a `writeWithTransaction` lock →
 * reactive state-to-DOM subscription (coalesced via `queueMicrotask` unless
 * `batch === false`, with `value` paths written through
 * `safeWriteValueWithCursor`) → DOM-to-state listener on each `events` entry
 * that re-reads every bound path, diffs with `Object.is`, and pushes changes
 * via `update()`. Internal (transaction-locked) writes are ignored on the way
 * back, breaking echo loops; disposed sessions stop syncing.
 *
 * @param element - Mounted host element (bridge endpoint).
 * @param session - Live session supplying state and disposal status.
 * @param bridgeOptions - Bindings applied by this activation.
 * @returns A cleanup unsubscribing the state feed and removing all DOM
 * listeners. Sessions without internals yield an empty cleanup.
 *
 * @example
 * ```ts
 * import { setupBridge } from '@sandlada/document-context'
 *
 * const cleanup = setupBridge(element, session, { properties: { count: 'dataset.count' } })
 * cleanup()
 * ```
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
