/**
 * Application layer: the Phase 2 verbs and the composition root.
 *
 * @packageDocumentation
 */

export { createApplication } from './application'
export type { Application, AttachConfig, AttachHandle } from './application'

export { buildPorts } from './application/ports-contract'
export type { ApplicationOptions } from './application/ports-contract'

export { assertOwnedSession, isOwnedSession } from './application/isolation'

export { merge } from './api/merge'
export { provide } from './api/provide'
export type { ProvideOptions } from './api/provide'
export { onAdopt, onDispose, onMount, onResume, onSuspend } from './api/hooks'
export { mountSession } from './api/mount'
export type { MountOptions } from './api/mount'
export { beginInjection, injectToken, injectToken$ } from './api/inject'
export type { InjectOptions } from './api/inject'
export { beginInjectAll, injectAllTokens, injectAllTokens$ } from './api/inject-all'
export type { InjectAllOptions } from './api/inject-all'
export { readState } from './api/read'
export { updateState } from './api/update'
export { disposeSession } from './api/dispose'
export { subscribeState } from './api/subscribe'
export { sessionAt, sessionStream } from './api/session-stream'

export type {
    ApplicationLimits,
    ApplicationPorts,
    CacheSlot,
    InjectDirection,
    PendingRequest,
} from './context'
export { DEFAULT_LIMITS } from './context'
