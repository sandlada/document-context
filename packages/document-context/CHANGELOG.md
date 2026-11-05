# Changelog

All notable changes to `@sandlada/document-context` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Calendar Versioning](https://calver.org/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Line layout**
>
> - `0.0.2-20261105.a` — the next generation (formerly developed with provisional 0.1.0 tags prior to public release). Design corpus: [`docs/archive/0.0.2`](../../docs/archive/0.0.2/README.md).
> - `0.0.1-20261008.a` — the historical release line. Snapshot in [`packages/site`](../../packages/site).

## [Unreleased]

## [0.0.2-20261105.a] - Next generation implementation

The initial release of the next-generation architecture (`0.0.2-20261105.a`):
`domain` → `application` → `infrastructure`, single composition root, and three vitest projects (unit / integration / e2e) covering every invariant of the design corpus.

### Added

- Two-phase model: `createContext` / `pipe` build an immutable, side-effect-free **blueprint**; `mount(blueprint, options?)(host)` returns a `Session` **synchronously**, and `session.ready` reports initialization completion.
- Data-last verbs: every operator and runtime verb has the shape `operation(config)(target)`.
- Dependency injection with declared dependencies (`uses` / `use`), lazy by default, `eager` opt-in, and three caching lifecycles (`scoped` / `singleton` / `transient`).
- Late binding: `inject` / `inject$` / `injectAll` / `injectAll$` resolve along the physical DOM ancestor chain and may run before the provider mounts.
- Keyed sessions: a keyed session suspends when its host disconnects and can be resurrected on a new host within a TTL, preserving state.
- Cross-bundle resolution over the W3C Context Protocol: `context-request` / `context-mount` / `context-dispose` DOM events, with string identities so separate bundles need no shared import.
- Composition root: `createApplication({ host, ssr? })` assembles the runtime shell; `domain` ← `application` ← `infrastructure` layering is enforced.
- SSR: the same verbs run against a `serverHost`; state stays in memory and HTML is written by the caller.
- Reactive surface: `state$`, `errors$`, `lifecycle$` and `session$` as RxJS observables; `rxjs` is a required peer dependency.
- Layered implementation: `src/domain` (models + ports, zero DOM), `src/application` (composition root, session runtime, scope lifecycles, streams, Phase 2 verbs), `src/infrastructure/dom` (host adapter, centralized observer, Context Protocol bus) and `src/infrastructure/ssr` (placeholder host, per-request application).
- Application-level limits: 32 suspended sessions, 1024 pending injections, and idempotent `release()`.
- Public error code `FOREIGN_SESSION`: operating on a session through an application that does not own it is rejected instead of silently doing nothing.

### Changed

- **BREAKING**: `mount` is synchronous. The legacy `await mount(blueprint)(host)` becomes `const session = mount(blueprint)(host)` followed by `await session.ready`.
- **BREAKING**: `update` **replaces** the whole state. The legacy shallow-merge semantics are gone; use the pure `merge(base, patch)` helper for deep merging.
- **BREAKING**: the `*Sync` tier (`mountSync`, `injectSync`, `selectSync`, `provideSync`, `injectAllSync`) is removed. There is exactly one mount path and one provide path.
- **BREAKING**: `provide` accepts a factory returning a value **or** a `Promise`; laziness is expressed with options instead of separate function names.
- **BREAKING**: `defineToken<T>(visibility?)(name)` replaces `defineToken` / `definePrivateToken`. A public token's runtime identity is the `namespace:name` string, so separate bundles resolve the same token without sharing a module instance.
- **BREAKING**: `multi: true` registrations and single-value registrations are separate pools. `injectAll` collects the multi pool; a single-value `inject` never resolves a multi registration.
- **BREAKING**: `detail.callback` may receive a **Promise** when the provider's factory is asynchronous. Consumers await the value.

### Removed

- `persist`, `serialize`, `hydrate` and any built-in storage or payload codec. State lives in session memory; persistence and hydration are the caller's job.
- The built-in DOM projection layer. Map state to the DOM with `state$` and your own code.
- `definePrivateToken`.

## [0.0.1-20261008.a] - Historical release

The initial release line (`0.0.1-20261008.a`). Archived snapshot preserved in `packages/site/src/content/docs/0.0.1-20261008.a/`.

[Unreleased]: https://github.com/sandlada/document-context/compare/v0.0.2-20261105.a...HEAD
[0.0.2-20261105.a]: https://github.com/sandlada/document-context/compare/v0.0.1-20261008.a...v0.0.2-20261105.a
[0.0.1-20261008.a]: https://github.com/sandlada/document-context/releases/tag/v0.0.1-20261008.a
