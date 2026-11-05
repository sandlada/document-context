/**
 * Domain layer: pure models and port contracts.
 *
 * The domain layer never imports the application or the infrastructure layer and never touches a
 * DOM global.
 *
 * @packageDocumentation
 */

export {
    DocumentContextError,
    isDocumentContextError,
    toDocumentContextError,
} from './model/errors'
export type { DocumentContextErrorOptions, ErrorCode } from './model/errors'

export {
    defineToken,
    isPrivateToken,
    isPublicToken,
    validateTokenName,
} from './model/token'
export type {
    PrivateToken,
    RegisteredService,
    ServiceRegistry,
    Token,
    TokenLike,
    TokenVisibility,
} from './model/token'

export { copyState, createContext, isPlainObject, pipe } from './model/blueprint'
export type {
    Blueprint,
    BlueprintOperator,
    Factory,
    FactoryTools,
    HookFn,
    HookRegistration,
    HookType,
    ProviderLifecycle,
    ProviderRegistration,
} from './model/blueprint'

export { lifecycleEventForStatus } from './model/lifecycle'
export type {
    DisposalReason,
    LifecycleEvent,
    LifecycleEventType,
    SessionStatus,
} from './model/lifecycle'

export { isSession } from './model/session'
export type {
    Host,
    HostEvent,
    HostEventListener,
    HostKind,
    HostListenerOptions,
    LateTarget,
    MountTarget,
    ServerHost,
    Session,
} from './model/session'

export type { ConnectivityPort, HostAdapter, TokensPort } from './ports/host'
export type { SchedulerPort } from './ports/scheduler'
export type {
    ContextAnnouncement,
    ContextRequestDetail,
    ProviderDeclaration,
    ScopeTransportPort,
} from './ports/scope-transport'
export type { SsrPort } from './ports/ssr'
