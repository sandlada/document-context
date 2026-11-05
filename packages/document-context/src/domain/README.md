# Domain Layer

The `domain` layer defines the pure domain model, port contracts, and use-case types for `@sandlada/document-context`.

It has **zero dependencies on the DOM** and performs **zero I/O**.

## Invariants

1. **No DOM imports**: must not reference `window`, `document`, `HTMLElement`, `Event`, or DOM APIs.
2. **Layer isolation**: must never import from `../application` or `../infrastructure`.
3. **Pure blueprints**: Phase 1 blueprint operators (`createContext`, `pipe`, `defineToken`) only produce immutable data structures.
4. **Error contracts**: all domain failures instantiate `DocumentContextError` with a standard `ErrorCode`.

## Key Exports

- **Blueprints**: `createContext`, `pipe`, `copyState`, `isPlainObject`, `Blueprint`, `BlueprintOperator`.
- **Tokens**: `defineToken`, `isPublicToken`, `isPrivateToken`, `validateTokenName`, `Token`, `PrivateToken`, `TokenLike`.
- **Sessions & Hosts**: `isSession`, `Session`, `Host`, `ServerHost`, `MountTarget`, `LateTarget`.
- **Lifecycle Types**: `SessionStatus`, `LifecycleEvent`, `LifecycleEventType`, `DisposalReason`.
- **Errors**: `DocumentContextError`, `ErrorCode`, `isDocumentContextError`.
- **Port Contracts**: `HostPort`, `HostAdapter`, `ConnectivityPort`, `TokensPort`, `SchedulerPort`, `ScopeTransportPort`, `SsrPort`.
