/**
 * Well-known event name for the W3C Community Context Protocol request
 * channel. Dispatched by `inject()` / `injectAll()` and answered by
 * `setupProviderResponder()` hosts. Always `bubbles: true`,
 * `composed: true`, `cancelable: true` so requests cross shadow boundaries.
 */
export const CONTEXT_REQUEST_EVENT = 'context-request'

/**
 * Response callback carried in `ContextRequestDetail`.
 *
 * The provider invokes it with the resolved value; the optional second
 * argument unsubscribes a streaming (`subscribe: true`) feed.
 *
 * @param value - Resolved service instance or state slice.
 * @param dispose - Optional streaming unsubscribe for `subscribe: true`
 * requests.
 * @returns `void`.
 */
export type ContextCallback<ValueType> = (
    value: ValueType,
    dispose?: () => void
) => void

/**
 * Event `detail` payload for a context request.
 *
 * @property context - Requested token (string key or branded token object).
 * @property callback - Invoked by the answering provider with the value.
 * @property subscribe - When `true`, the provider keeps pushing updates
 * (state-slice streaming) until the `dispose` callback runs.
 * @property multi - When `true`, every ancestor answers and the event keeps
 * bubbling (`injectAll`); when `false`, the first answer stops propagation.
 */
export interface ContextRequestDetail<ContextType, ValueType> {
    readonly context: ContextType
    readonly callback: ContextCallback<ValueType>
    readonly subscribe?: boolean | undefined
    readonly multi?: boolean | undefined
}

/**
 * Standard W3C Community Context Protocol request event.
 *
 * Dispatched synchronously from the injection target so ancestors can answer
 * in the same task. Construct with `(context, callback, { subscribe, multi
 * }?)`; both flags default to `false`.
 *
 * @param context - Token being requested.
 * @param callback - Response callback receiving the resolved value.
 * @param options - Optional `{ subscribe, multi }` flags.
 * @returns A bubbling, composed, cancelable `CustomEvent`.
 *
 * @example
 * ```ts
 * import { ContextRequestEvent } from '@sandlada/document-context'
 *
 * const event = new ContextRequestEvent('logger', (value, dispose) => {
 *     console.log('got logger', value)
 * })
 * element.dispatchEvent(event)
 * ```
 */
export class ContextRequestEvent<
    ContextType = any,
    ValueType = any
> extends CustomEvent<ContextRequestDetail<ContextType, ValueType>> {
    constructor(
        context: ContextType,
        callback: ContextCallback<ValueType>,
        options?: { subscribe?: boolean; multi?: boolean }
    ) {
        super(CONTEXT_REQUEST_EVENT, {
            bubbles: true,
            composed: true,
            cancelable: true,
            detail: {
                context,
                callback,
                subscribe: options?.subscribe ?? false,
                multi: options?.multi ?? false
            }
        })
    }
}
