/**
 * DOM infrastructure: the host adapter, the centralized observer and the Context Protocol bus.
 *
 * @packageDocumentation
 */

export {
    createDomHostAdapter,
    createBrowserScheduler,
    KEYED_IDENTITY_ATTRIBUTE,
} from './host-adapter'
export type { DomHost, DomHostAdapter } from './host-adapter'

export { createDomObserver } from './observer'
export type { DomObserver } from './observer'

export { createDomScopeTransport, isElement } from './scope-transport'
export type { DomScopeTransport } from './scope-transport'

export {
    CONTEXT_DISPOSE_EVENT,
    CONTEXT_MOUNT_EVENT,
    CONTEXT_REQUEST_EVENT,
    dispatchContextAnnouncement,
    dispatchContextRequest,
    listenContextRequest,
} from './context-protocol'
export type { ContextAnnouncementDetail } from './context-protocol'

export { composedAncestors, composedParent, domContains, isShadowRoot } from './session-stream'
