export const CONTEXT_REQUEST_EVENT = 'context-request'

export type ContextCallback<ValueType> = (
    value: ValueType,
    dispose?: () => void
) => void

export interface ContextRequestDetail<ContextType, ValueType> {
    readonly context: ContextType
    readonly callback: ContextCallback<ValueType>
    readonly subscribe?: boolean | undefined
    readonly multi?: boolean | undefined
}

/**
 * Standard W3C Community Context Protocol request event.
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
