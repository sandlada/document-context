# Changelog

All notable changes to `@sandlada/document-context` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Calendar Versioning](https://calver.org/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Line layout**
>
> - `0.0.2-20261105.a` — the next generation (formerly developed with provisional 0.1.0 tags prior to public release). Design corpus: [`docs/archive/0.0.2`](../../docs/archive/0.0.2/README.md).
> - `0.0.1-20261008.a` — the historical release line. Snapshot in [`packages/site`](../../packages/site).

## [Unreleased]

### Fixed

- Keyed resuscitation no longer re-runs `onMount` after it already ran on the first `active` transition; skipped `onMount` hooks still run once on the first resume, then only `onResume` on later resumes.
- Resuming a keyed session rebinds connectivity watching to the new host so later disconnects suspend correctly.
- `onSuspend` is not invoked when a session moves from `starting` straight to `suspended` during initialization.
- Pending injections that wait on a `Session` target are rejected with `DISPOSED_SESSION` when that session is disposed.
- Resuming a keyed session moves its identity onto the new host and removes it from the previous host.
- `injectAll` on a session target with `{ wait: true }` stays pending until a multi provider appears, instead of fulfilling with `[]`.
- A later singleton registration no longer wins at resolution time: injection uses the first registrant's factory.
- Cross-bundle `injectAll` reverses host groups only, so registrations on one host keep their blueprint order.
- Public `provide` / `inject` / `injectAll` and keyed-identity writes reject names that are not `namespace:name` with `TOKEN_INVALID`. Private tokens skip that check.
- A cross-host keyed conflict is rejected before `onConflict: 'replace'` disposes the session already on the target host. Replacing a host with a suspended token resumes that session instead of leaving the previous one mounted.
- `merge` deep-copies untouched nested plain objects, so mutating the result does not change the base.
- The public entry points reject `Sync` / `Async` export names. Fake hosts can report adoption, and a fake adapter can mount an SSR placeholder through `SsrPort`.
- Releasing an application rejects still-pending element injections with `DISPOSED_SESSION` instead of leaving their promises pending. The second `release()` stays a no-op.
- Disposing the session that owns a singleton drops that slot, so a later registration can create a new instance instead of receiving the disposed one.
- Releasing a DOM host adapter removes its `context-mount` document listener, so a released adapter no longer wakes pending injections.
- An error pushed while `errors$` is draining its initialization buffer is delivered to that first subscriber instead of being dropped.
- A `state$` or `lifecycle$` event raised from the callback that receives the current snapshot or backed status is delivered to that subscriber instead of being dropped.
- `session$` subscribes to session changes before it emits the current value, so disposing that session inside the first callback still delivers `null`.
- `session$` also follows host connectivity, so it emits `null` as soon as the host is disconnected, before the session is suspended.
- `copyState` and `merge` keep a `Object.create(null)` prototype instead of turning the copy into a normal object.
- `copyState` skips `__proto__`, `constructor`, and `prototype`, the same keys `merge` refuses to copy.
- Declared `uses` of a transient or prototype factory are created once per registration. Injecting that dependency directly still runs its factory every time.
- A later `multi` singleton registration is left out of `injectAll` and does not run its factory. The session still receives `SINGLETON_CONFLICT`.
- A suspended singleton owner does not answer `inject`. After it resumes, callers receive the original instance.
- A function returned from `onDispose` runs as a cleanup. A promise returned from `onDispose` is still waited on, and its resolved value is not a cleanup.
- A single-value `context-request` sets `detail.resolved` after `callback`. If `callback` throws, farther providers can still answer.
- `onAdopt` runs only while the session is `active`. A suspended session ignores adoption and keeps its `suspended` lifecycle event.
- A skipped `onMount` that returns a promise finishes before `onResume` and activation. If that promise rejects, the session is disposed and does not become `active`.
- If the new host disconnects while that promise is still pending, the session stays suspended and can be resumed later.
- The fake host honors `AbortSignal` on `host.on`: an already aborted signal adds no listener, and a later abort removes it.
- `attach` reports adoption through `onAdopt` only. A host that stays connected does not also emit `onConnect`.
- `setDefaultApplication` releases the previous default application and the DOM adapter this module created for it.
- Unsubscribing `inject$` or `injectAll$` completes the stream and does not send an error or write `errors$`.
- Moving a connected element inside the document updates `session$` to the new nearest session without treating the move as a disconnect.
- A pending element `inject` resolves when that element is moved under an already active provider, instead of waiting for a new mount.
- A rejected promise from `onDispose`, `onSuspend`, or `onResume` is reported on `errors$` as `HOOK_ERROR`. The resolved value is still not used as a cleanup.
- A dynamic `inject` that circles back to a factory already waiting on that call is rejected with `CIRCULAR_DEPENDENCY` instead of deadlocking. Joining an in-flight factory from outside it still shares the same promise.
- A second `transient` or `prototype` injection starts another factory while the first is still running, instead of rejecting `CIRCULAR_DEPENDENCY`. `scoped` and `singleton` injections still share the in-flight promise.
- An element `inject` of a factory that is already running on a `starting` session joins that factory. When the caller is the factory itself, the injection is rejected with `CIRCULAR_DEPENDENCY` instead of waiting on `ready`.
- An in-flight `inject` rejects with `DISPOSED_SESSION` when its session is disposed. Unsubscribing one caller still leaves the shared factory running.
- An element `injectAll` of a multi factory already running on a `starting` session joins that factory. When the caller is the factory itself, the collection is rejected with `CIRCULAR_DEPENDENCY` instead of waiting on `ready`.
- `suspensionTtlMs: 0` disposes a keyed session on a confirmed disconnect, with reason `disconnect`, and does not enter `suspended` or run `onSuspend`. A pinned session still suspends.
- A pending element `inject` rejects with `DISPOSED_SESSION` when the session that owns that element is disposed, even if the element stays connected.
- `update` accepts the next snapshot directly, as well as a function. Keys omitted from that snapshot are removed.
- A `uses` dependency provided by an ancestor that is still `starting` waits for that factory. It is not rejected as `UNKNOWN_SERVICE`.

### Changed

- Multi-value injection ordering helpers are shared between `injectAll` and the pending retry path (`multi-resolve.ts`).

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
