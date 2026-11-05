# Application Layer

The `application` layer coordinates Phase 2 verbs, session runtimes, dependency injection resolution, and lifecycle state machines.

It implements the composition root and orchestrates domain ports without directly importing infrastructure implementations.

## Invariants

1. **Port dependence only**: interacts with the outside world exclusively through domain ports (`HostAdapter`, `ScopeTransportPort`, `SchedulerPort`, `SsrPort`).
2. **No infrastructure imports**: must never import from `../infrastructure`.
3. **Data-last currying**: verbs take configuration first and session or target last (`operation(config)(target)`).
4. **Zero-leak lifecycle**: manages abort boundaries, unsubscribes cleanly upon disposal, and bounds suspended sessions by TTL and capacity limits.

## Key Exports

- **Composition Root**: `createApplication`, `Application`, `ApplicationOptions`, `ApplicationLimits`, `ApplicationPorts`.
- **Phase 2 Verbs**:
  - `mountSession`, `MountOptions`
  - `provide`, `ProvideOptions`
  - `injectToken`, `injectToken$`, `beginInjection`, `InjectOptions`
  - `injectAllTokens`, `injectAllTokens$`, `beginInjectAll`, `InjectAllOptions`
  - `readState`, `updateState`, `subscribeState`, `disposeSession`
  - `sessionAt`, `sessionStream`
  - `onMount`, `onDispose`, `onSuspend`, `onResume`, `onAdopt`
  - `merge`
- **Isolation & Contracts**: `assertOwnedSession`, `isOwnedSession`, `buildPorts`.
