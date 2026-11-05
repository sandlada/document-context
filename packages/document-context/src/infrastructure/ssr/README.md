# SSR Infrastructure Layer

The `infrastructure/ssr` layer implements domain ports for server-side execution and placeholder environments.

## Invariants

1. **Per-request isolation**: creates an isolated `Application` per request via `createSsrApplication()`, ensuring singletons and keyed sessions do not leak between requests.
2. **Minimal capability host**: server placeholder hosts have no parent hierarchy, no DOM events, and reject native DOM operations with `HOST_INVALID`.
3. **In-memory scope transport**: maintains provider declarations in memory without DOM event dispatch.

## Key Exports

- **Request Application**: `createSsrApplication`.
- **SSR Host Adapter**: `createSsrHostAdapter`, `SsrHost`, `SsrHostAdapter`.
- **SSR Scope Transport**: `SsrScopeTransport`.
- **SSR Port & Scheduler**: `createSsrPort`, `createServerScheduler`.
