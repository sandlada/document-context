# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

`@sandlada/document-context` is a private-use, browser-side ESM package that provides a function-first IoC container hosted on HTML objects. Consumers call `createContext()` and `mount()` to register a reactive state object on any host (`document`, an `HTMLElement`, or any plain `object`), then read/write state via `readState`, `updateState`, `subscribeState`, and friends. The state shape is owned by the caller — the library has no business semantics. Internal state changes can be mirrored live onto DOM properties via the bidirectional `bridgeState` API, and persisted via pluggable storage adapters (default: `localStorage`).

## Commands

```bash
npm run build   # tsdown → ./build (ESM + .d.ts, cleans outDir first)
npm test        # vitest run (happy-dom env, ./test/setup.ts preloaded)
```

- Run a single test file: `npx vitest test/core.test.ts` or `npx vitest test/integration.test.ts`
- Run a single `describe`/`it` by name: `npx vitest -t "bridgeState"`
- Watch mode: `npx vitest`

## Architecture (functional core, thin adapter layer)

Two flat layers under `src/`, plus a composition root. No `domain`/`application`/`infrastructure` split — all core logic lives as top-level pure functions in `src/core/`, and the only side effects are isolated in `src/adapters/`.

| Layer            | Path                         | Role                                                                                                                                                                                                                                                                                                              |
| ---------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional core  | `src/core/`                  | All public verbs: `createContext`, `defineScope`, `mount`, `readState`, `updateState`, `subscribeState`, `bridgeState`, `provide`, `inject`, `saveState`, `loadState`, `dispose`, `readErrorStream`. Each is a top-level pure function operating on an opaque `ISession` token. No classes, no `this`.                |
| Adapters         | `src/adapters/`              | Side-effecting primitives called from the core: `local-storage.ts` (`getStorageAdapter('localStorage')`) and `dom-mutation.ts` (`watchRemoval(target, cb)`). Adapters are not exported from `src/index.ts` — they are resolved by string name.                                                                     |
| Composition root | `src/index.ts`               | Single re-export: `export * from './core/index'; export * from './errors'; export type { Observable, Subscription } from 'rxjs';`. No ambient `Document` augmentation.                                                                                                                                              |
| Errors           | `src/errors.ts`              | `LibraryError` and subclasses (`CircularDependencyError`, `UnknownScopeError`, `UnknownServiceError`, `InvalidInitialStateError`, `InvalidStoredStateError`, `InvalidPropertyError`, `PropertySyncError`). Re-exported so consumers can use `instanceof`.                                                          |

### `src/core/` flat layout

```
src/core/
    index.ts            // re-export aggregator
    context.ts          // createContext<S>(initial)
    scope.ts            // defineScope<T>(name), IScopeToken<T>
    state-store.ts      // createStateStore (immutable, deepFreeze optional)
    mount.ts            // mount(target, ctx, options) + idempotency cache
    read-state.ts
    update-state.ts
    subscribe-state.ts
    bridge.ts           // bidirectional property sync
    provide.ts          // service registry
    inject.ts           // scope chain resolution + lifecycle
    save-state.ts
    load-state.ts
    dispose.ts          // runs every registered disposer
    error-stream.ts     // readErrorStream(session) -> Observable<LibraryError>
    internals/
        branding.ts     // SessionBrand, InternalWriteSymbol, ScopeBrand
        session.ts      // ISession<S>, IState, IMountOptions, IBridgeOptions, IStateStore
        property-path.ts// readPropertyPath / writePropertyPath (dot-path syntax)
        state-mutations.ts  // sessionReplace internal helper
```

### Reactive flow

```
updateState(session, partial)
    └─→ session.store.update(partial)        // createStateStore
            └─→ BehaviorSubject<Readonly<S>>.next(frozenNext)
                    ├─→ bridgeState subscription → flush() → writePropertyPath(target, path, value)
                    │       (gated by InternalWriteSymbol to prevent DOM→JS loops)
                    ├─→ subscribeState callbacks
                    └─→ readErrorStream is unaffected (errors only)

DOM event (input/change) on target
    └─→ bridgeState handler reads target[path]
            └─→ if changed vs. state → session.store.update(partial) → same reactive flow above
```

`mount()` attaches the bridge automatically when `options.sync` is supplied. `watchRemoval` (via `MutationObserver`) calls `dispose(session)` when the host node leaves the DOM tree, so subscriptions and listeners are torn down automatically.

### `ISession<S>` (opaque token)

`mount()` returns an `ISession<S>` token branded with `SessionBrand`. It is the only required argument to every public verb. There is no `IBoundUseCases` aggregate — each verb takes the session directly. Consumers keep the token in a closure, on a global symbol, or anywhere they like.

```ts
export interface ISession<S extends IState> {
    readonly [SessionBrand]: true;
    readonly target: object;
    readonly schemas: S;
    readonly options: Readonly<IMountOptions<S>>;
    readonly store: IStateStore<S>;
}
```

## Public API surface

Re-exported from `src/index.ts`. `ISession` and `IState` are types only.

### State

- `createContext<S extends IState>(initial: S): IContext<S>` — captures the schema; `S` is inferred from `initial`.
- `defineScope<T = unknown>(name: string): IScopeToken<T>` — returns a branded scope token.
- `mount<S extends IState>(target, ctx, options?): ISession<S>` — registers a session on `target`. **Idempotent** per `(target, ctx.schema)` pair; repeated calls return the same token.
- `readState<S>(session): Readonly<S>` — frozen snapshot of the current state.
- `updateState<S>(session, partial: Partial<S>): Readonly<S>` — merges and returns the new state.
- `subscribeState<S>(session, fn): () => void` — returns an unsubscribe function.

### Bridge

- `bridgeState<S>(session, options: IBridgeOptions<S>): () => void` — proxied back to `mount({ sync })` for users that want to add a bridge after mount.

`IBridgeOptions` defaults: `events: ['input', 'change']`, `batch: true`, `ignoreInternalWrite: true`, `conflict: 'lastWriteWins'`. Property paths use dot syntax (`dataset.count`, `style.color`).

### Storage adapters

- `saveState<S>(session, { adapter: 'localStorage', key: string }): void`
- `loadState<S>(session, { adapter: 'localStorage', key: string }): void`

`loadState` is tolerant: invalid JSON or a non-object payload leaves the current state intact and emits nothing on `errorStream`. Only adapter-known keys (today: `'localStorage'`) are accepted.

### IoC

- `provide<T, S>(session, token, factory, options?: { lifecycle?: 'singleton' | 'transient' | 'scoped' }): void`
- `inject<T, S>(session, token): T`

Resolution order: walk `session → session.options.scope.parent → ...` until a session with the token is found; falls back to a global registry of every `provide()`'d session. Throws `UnknownServiceError` if the token is not registered. Throws `CircularDependencyError` (and emits on `readErrorStream`) if the token re-enters its own resolution stack.

### Lifecycle

- `dispose<S>(session): void` — runs every registered disposer (bridge subscription, event listeners, mutation observer), then poisons `session.store` so subsequent verbs throw.

The `readErrorStream(session): Observable<LibraryError>` function returns a per-session `rxjs` Subject of `LibraryError` events (today: `CircularDependencyError` from `inject`). Consumers subscribe to it for non-fatal error reporting.

### Idempotency

`mount()` is the only idempotent verb. Calling it a second time with the same `target` and the same `ctx.schema` returns the existing session token without creating a new store or bridge. This lets multiple modules share a single root context safely.

### Bidirectional property bridge defaults

`bridgeState` keeps JS state and DOM properties in sync both ways. Out of the box:

- **JS → DOM**: every `updateState` writes new property values via `queueMicrotask` (when `batch: true`) or synchronously (when `batch: false`). Skips writes when the live DOM value already matches state.
- **DOM → JS**: every `input` / `change` event on the target is read back into state. The `InternalWriteSymbol` flag on the target is set during JS-initiated writes and cleared after, so the resulting event is ignored — this is the loop guard.
- **Conflict**: `lastWriteWins` (the default). `statePrecedence` is reserved for a future release; `domPrecedence` makes the DOM value authoritative until the next event.
- **Freeze**: shallow by default; `deepFreeze: true` deep-freezes every state snapshot.

### IoC lifecycle

| Lifecycle    | Behavior                                                                         |
| ------------ | -------------------------------------------------------------------------------- |
| `singleton`  | One instance per token across the whole process (default).                      |
| `transient`  | A fresh instance is constructed on every `inject()`.                             |
| `scoped`     | One instance per session that resolves the token; different sessions get distinct instances. |

`singleton` instances survive `dispose()` of the session that registered them; `transient` and `scoped` are torn down with the session. `provide()` runs an eager cycle-check by invoking the factory once (the result is discarded) so forward references are tolerated but recursive cycles throw immediately.

## TypeScript / build conventions

- `tsconfig.json` enables: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUncheckedSideEffectImports`, `verbatimModuleSyntax`, `isolatedModules`. ES2022 target, ESNext modules, `moduleResolution: bundler`.
- `tsdown.config.ts`: single entry `src/index.ts`, ESM only, browser platform, dts emitted, cleans `outDir` (`./build`) on each build.
- `package.json` `exports` only ships `./build/index.{js,d.ts}` — `rxjs` is only a `devDependency` because the public API only re-exports `Observable`/`Subscription` types.
- VS Code workspace enables `typescript.native-preview.tsdk` and `js/ts.experimental.useTsgo` (project files `.vscode/settings.json` + `.vscode/setting.json`).
- `.editorconfig`: 4-space indent, LF, single quotes, `max_line_length = 240`, final newline.
- State is immutable. `createStateStore.update` / `replace` always build a new `S`; never mutate the result of `readState(session)` in place.

## Testing

- `test/core.test.ts` — pure logic: `SessionBrand`, `createStateStore`, `createContext`, `defineScope`, `mount` (idempotency, isolation), `readState` / `updateState`, `subscribeState`, `provide` / `inject` (singleton / transient / scoped), circular-dependency detection + `readErrorStream` emissions.
- `test/integration.test.ts` — DOM-bound: `localStorage` adapter round-trip, `bridgeState` (JS → DOM, DOM → JS, `ignoreInternalWrite` loop guard, `batch: true` coalescing), `dispose` (manual + `MutationObserver` auto-cleanup on host removal).
- `test/setup.ts` runs before every test: stubs `localStorage` with an in-memory mock, deletes every Symbol property on `document.documentElement`, calls `document.removeAllListeners?.()`. Do not touch `test/setup.ts` — every new test relies on its reset semantics.
- Tests access the session token via the imported `ISession<S>` type. When adding new tests, follow the nested-`describe` pattern (e.g. `describe("bridgeState")`). New test files must match `test/**/*.test.ts` to be picked up.

## Common pitfalls

- Don't import from `rxjs` in any file other than `src/core/internals/*`, `src/core/state-store.ts`, `src/core/subscribe-state.ts`, `src/core/error-stream.ts`, and `src/adapters/*` — it would leak into the public bundle. The public types are re-exported from `src/index.ts` only.
- Don't add `eslint-disable` unless the existing comment shows the same pattern. `@ts-ignore` only appears in `test/setup.ts` to call `document.removeAllListeners?.()`.
- The `build/` directory is generated — never edit files there, never commit them (`build/` is gitignored).
- `mount()` is idempotent for the same `(target, ctx.schema)` pair but **not** for different schemas on the same target. If you genuinely need multiple sessions on one host, pass distinct context objects.
