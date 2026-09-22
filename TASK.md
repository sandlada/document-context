# Project Tasks & Execution Roadmap (TASK.md)

This document outlines the systematic implementation plan, milestone tasks, and execution tracking for `@sandlada/document-context`. All specifications, architecture invariants, and coding conventions strictly follow [`DESIGN.md`](./DESIGN.md) and [`AGENTS.md`](./AGENTS.md).

---

## ⚡ Strict Test-First (TDD) Execution Protocol (測試優先與 TDD 執行鐵律)

All code implementation in this project strictly follows **Test-Driven Development (TDD)**:

1. **Red (測試先行)**: For any new feature, operator, verb, or bugfix, the sibling `*.test.ts` test file **MUST** be written first before writing any implementation code in `*.ts`. Test cases must thoroughly specify expected behavior, edge cases, error conditions, and lifecycle invariants.
2. **Green (最小實現)**: Implement the minimal code in `*.ts` to satisfy the tests. Run `npm test` or `npx vitest <file>.test.ts` to confirm 100% green pass.
3. **Refactor (重構驗證)**: Refactor and optimize without breaking tests.
4. **Co-location (同級 1:1 對應)**: Every `*.ts` file must have a sibling `*.test.ts` in the exact same directory (excluding pure `index.ts` re-exports and `.d.ts` declaration files).

---

## Milestone 0: P0 Core Foundation & FP Operator Architecture (`@sandlada/document-context/core`)

The goal of Milestone 0 is to implement the pure functional blueprint architecture, Data-Last curried APIs, immutable state store, lifecycle hooks, and TC39 Explicit Resource Management using strict TDD.

### 0.1 Project Infrastructure, Type Definitions & Test Environment Setup

- [x] Clean up legacy codebase in `src/` and establish modular subpath directory structure (`src/core/`, `src/bridge/`, `src/storage/`, `src/dom/`, `src/signals/`).
- [x] Configure `package.json` (`exports`), `tsconfig.json`, and `tsdown.config.ts` for clean ESM subpath packaging (`./core`, `./bridge`, `./storage`, `./dom`, `./signals`).
- [x] **Pre-Coding Test Infrastructure Initialization**:
  - [x] Configure `vitest.config.ts` (`include: ['src/**/*.test.ts']`, `environment: 'happy-dom'`).
  - [x] Configure `.vscode/settings.json` (`explorer.fileNesting.enabled: false`) to ensure `*.test.ts` and `*.ts` are co-located at the same explorer hierarchy level.
  - [x] Establish strict 1:1 test file co-location: every `*.ts` source file has a corresponding sibling `*.test.ts` test file in the exact same directory (e.g., `src/core/mount.ts` <-> `src/core/mount.test.ts`).
  - [x] Exclude `index.ts` (re-export aggregator) and pure `.d.ts` declaration files from requiring test files.
- [x] **TDD Step 1: Core Type Tests & Implementation** (`src/core/types.test.ts` <-> `src/core/types.ts`):
  - [x] `src/core/types.test.ts`: Compile-time & runtime type assertions for `ISession`, `IContextBlueprint`, `IServiceRegistration`, `ServiceToken`, `ServiceLifecycle`, `ILifecycleHooks`, `IBridgeOptions`, `IStorageOptions`, and `ServiceRegistry`.
  - [x] `src/core/types.ts`: Implement complete core interface and type definitions.
- [x] **TDD Step 2: Error Taxonomy Tests & Implementation** (`src/core/errors.test.ts` <-> `src/core/errors.ts`):
  - [x] `src/core/errors.test.ts`: Test `DocumentContextError` base class (with `code`, `message`, `details`, `resolutionGuide`) and all specialized error classes (`CircularDependencyError`, `UnknownServiceError`, `AsyncServiceNotReadyError`, `DisposedSessionError`, `UnconnectedNodeError`, `PropertySyncSecurityError`, `HydrationMismatchError`, `InvalidStorageDataError`).
  - [x] `src/core/errors.ts`: Implement error taxonomy hierarchy.

### 0.2 Pure Blueprint Operators (Phase 1: Pure & Lazy Blueprint)

- [x] **TDD Step 1: Blueprint Creation & Pipeline Tests** (`src/core/context.test.ts`, `src/core/pipe.test.ts`):
  - [x] `src/core/context.test.ts`: Test pure lazy blueprint creation, immutability, zero DOM access, snapshot initialization, and structural sharing.
  - [x] `src/core/pipe.test.ts`: Test functional pipeline operator composition, progressive service type inference overloads, and immutability guarantees.
- [x] **TDD Step 2: Blueprint Creation & Pipeline Implementation** (`src/core/context.ts`, `src/core/pipe.ts`):
  - [x] Implement `createContext<S>(initialState: S): IContextBlueprint<S, {}>`.
  - [x] Implement `pipe(blueprint, ...operators)` pipeline utility with 1~10+ generic overloads.
  - [x] Verify 100% green tests via `npm test`.
- [x] **TDD Step 3: Service & Hook Operator Tests** (`src/core/providers.test.ts`, `src/core/hooks.test.ts`):
  - [x] `src/core/providers.test.ts`: Test pure lazy `withProvider` registration, lifecycle options (`'singleton'`, `'scoped'`, `'transient'`), multi-collection flags, and immutability (zero factory execution in Phase 1).
  - [x] `src/core/hooks.test.ts`: Test `withHook` registration across lifecycle events (`'mount'`, `'dispose'`, `'suspend'`, `'resuscitate'`, `'adopt'`).
- [x] **TDD Step 4: Service & Hook Operator Implementation** (`src/core/providers.ts`, `src/core/hooks.ts`):
  - [x] Implement `withProvider(token, factory, options)`.
  - [x] Implement `withHook(event, handler)`.
  - [x] Verify 100% green tests via `npm test`.

### 0.3 Runtime Session & Data-Last Verbs (Phase 2: Execution Boundary)

- [x] **TDD Step 1: Mount & State Verbs Tests** (`src/core/mount.test.ts`, `src/core/select.test.ts`, `src/core/update.test.ts`, `src/core/subscribe.test.ts`):
  - [x] `src/core/mount.test.ts`: Test `mount(blueprint)(element)` execution boundary, WeakMap session caching for idempotency, internal state store initialization, dev-mode `Object.freeze` immutability guard, FIFO mount hooks execution, `context-mount` CustomEvent dispatch, and `AbortController` binding.
  - [x] `src/core/select.test.ts`: Test `select(selector)(session)` synchronous snapshot reader and selector memoization.
  - [x] `src/core/update.test.ts`: Test `update(updater)(session)` state transitions (partial state & updater function), state change notifications, and safe silent No-op returning `false` on disposed session.
  - [x] `src/core/subscribe.test.ts`: Test `subscribe(listener)(session)` reactive state subscription, initial emission, change listener invocation, and unsubscribe cleanup function.
- [x] **TDD Step 2: Mount & State Verbs Implementation** (`src/core/mount.ts`, `src/core/select.ts`, `src/core/update.ts`, `src/core/subscribe.ts`):
  - [x] Implement `mount(blueprint)(element)`.
  - [x] Implement `select(selector)(session)`.
  - [x] Implement `update(updater)(session)`.
  - [x] Implement `subscribe(listener)(session)`.
  - [x] Verify 100% green tests via `npm test`.
- [x] **TDD Step 3: Session Teardown & Lifecycle Tests** (`src/core/dispose.test.ts`):
  - [x] `src/core/dispose.test.ts`: Test `dispose(session)` state store poisoning, LIFO execution of mount cleanups and dispose hooks, isolated `try...catch` error sandboxing, listener teardown, `session.abortSignal.abort()`, native `context-dispose` CustomEvent dispatch, non-fatal error stream (`readErrorStream`), and TC39 Explicit Resource Management (`[Symbol.dispose]` / `[Symbol.asyncDispose]`).
- [x] **TDD Step 4: Session Teardown & Lifecycle Implementation** (`src/core/dispose.ts`):
  - [x] Implement `dispose(session)` and `readErrorStream(session)`.
  - [x] Implement TC39 `[Symbol.dispose]` and `[Symbol.asyncDispose]` bindings on session.
  - [x] Verify 100% green tests via `npm test`.

---

## Milestone 1: P0 DOM Scope, W3C Protocol & Lifecycle GC (`@sandlada/document-context/dom`)

The goal of Milestone 1 is to implement native DOM tree traversal via W3C Context Protocol, Shadow DOM penetration, centralized MutationObserver, and microtask disconnect protection using strict TDD.

### 1.1 W3C Context Protocol Specification

- [x] **TDD Step 1: Protocol Events & Injection Tests** (`src/dom/events.test.ts`, `src/dom/inject.test.ts`):
  - [x] `src/dom/events.test.ts`: Test `ContextRequestEvent` class (`bubbles: true, composed: true, cancelable: true`, payload `{ context, callback, subscribe, multi }`).
  - [x] `src/dom/inject.test.ts`: Test `inject(token)(target)` resolution on `ISession` and `HTMLElement`, `node.isConnected` validation (`UnconnectedNodeError`), synchronous `ContextRequestEvent` dispatch, Open and Closed Shadow DOM penetration, process-wide fallback registry, and synchronous circular dependency Call Stack detection (`CircularDependencyError`).
  - [x] Test provider event responder in mounted host elements (`context-request` listener, scoped cache lookup, lazy factory instantiation, callback invocation, `stopPropagation()`, and streaming subscription cascade).
- [x] **TDD Step 2: Protocol Events & Injection Implementation** (`src/dom/events.ts`, `src/dom/inject.ts`):
  - [x] Implement `ContextRequestEvent` in `src/dom/events.ts`.
  - [x] Implement `inject(token)(target)` and provider event responders in `src/dom/inject.ts`.
  - [x] Verify 100% green tests via `npm test`.

### 1.2 Centralized Root MutationObserver & Zero-Leak GC

- [x] **TDD Step 1: MutationObserver & GC Lifecycle Tests** (`src/dom/observer.test.ts`):
  - [x] `src/dom/observer.test.ts`: Test document-level `CentralizedRootObserver`, `WeakMap` / `WeakRef` node tracking (strictly zero strong HTMLElement leaks), `FinalizationRegistry` GC cleanup fallback, microtask disconnect protection (`queueMicrotask` reparenting check preventing false-disposals during DOM moves), and cross-document migration (`adoptedCallback` / `adoptNode` triggering `adopt` hook and `context-adopt` event).
- [x] **TDD Step 2: MutationObserver & GC Lifecycle Implementation** (`src/dom/observer.ts`):
  - [x] Implement `CentralizedRootObserver` and microtask disconnect protection in `src/dom/observer.ts`.
  - [x] Verify 100% green tests via `npm test`.

---

## Milestone 2: P0 Bidirectional Property Bridge (`@sandlada/document-context/bridge`)

The goal of Milestone 2 is to build the real-time, zero-leak bidirectional bridge between JavaScript reactive state and DOM physical properties using strict TDD.

### 2.1 Bridge Property Accessor & Operators

- [x] **TDD Step 1: Property Path & Operator Tests** (`src/bridge/property-path.test.ts`, `src/bridge/with-bridge.test.ts`):
  - [x] `src/bridge/property-path.test.ts`: Test dot-path getter/setter engine for `dataset.*`, `style.*` (including CSS variables `--*`), `aria-*` (boolean-to-string sync), form properties (`value`, `checked`, `disabled`, `readOnly`), standard HTML properties (`id`, `lang`, `title`, `hidden`), and Form-Associated Custom Elements (`elementInternals`).
  - [x] `src/bridge/with-bridge.test.ts`: Test pure lazy `withBridge(options)` blueprint operator registration.
- [x] **TDD Step 2: Property Path & Operator Implementation** (`src/bridge/property-path.ts`, `src/bridge/with-bridge.ts`):
  - [x] Implement dot-path property engine in `src/bridge/property-path.ts`.
  - [x] Implement `withBridge` operator in `src/bridge/with-bridge.ts`.
  - [x] Verify 100% green tests via `npm test`.

### 2.2 Bridge Security & Sanitization

- [x] **TDD Step 1: Security & Sanitization Tests** (`src/bridge/sanitize.test.ts`):
  - [x] `src/bridge/sanitize.test.ts`: Test prototype pollution blocking (`__proto__`, `prototype`, `constructor` throwing `PropertySyncSecurityError`), DOM XSS sink rejection (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `srcdoc`, `script`, `eval`), type fidelity parsers (`Boolean`, `Number`, `JSON`), and HTML boolean attribute vs property semantics.
- [x] **TDD Step 2: Security & Sanitization Implementation** (`src/bridge/sanitize.ts`):
  - [x] Implement security guards and property sanitizers in `src/bridge/sanitize.ts`.
  - [x] Verify 100% green tests via `npm test`.

### 2.3 Bridge Concurrency & Loop Guard

- [x] **TDD Step 1: Loop Guard & Input Focus Tests** (`src/bridge/loop-guard.test.ts`):
  - [x] `src/bridge/loop-guard.test.ts`: Test Active Element input locking and cursor preservation (`selectionStart` / `selectionEnd`), snapshot diffing (`Object.is` short-circuit), transaction lock symbol (`InternalWriteSymbol` microtask lock), and microtask batch coalescing (`batch: true`).
- [x] **TDD Step 2: Loop Guard & Input Focus Implementation** (`src/bridge/loop-guard.ts`):
  - [x] Implement transaction locking, cursor preservation, and batching in `src/bridge/loop-guard.ts`.
  - [x] Verify 100% green tests via `npm test`.

---

## Milestone 3: P0 Persistence & Hydration Engine (`@sandlada/document-context/storage`)

The goal of Milestone 3 is to provide fault-tolerant state persistence, multi-tab synchronization, and SSR hydration precedence using strict TDD.

### 3.1 Storage Adapters & Hydration Precedence

- [x] **TDD Step 1: Storage Adapters & Hydration Tests** (`src/storage/adapters.test.ts`, `src/storage/hydration.test.ts`, `src/storage/with-storage.test.ts`):
  - [x] `src/storage/adapters.test.ts`: Test built-in `localStorage` and `sessionStorage` adapters, schema versioning, and migration functions (`migrate(persistedData, oldVersion)`).
  - [x] `src/storage/hydration.test.ts`: Test hydration strategies (`'storageFirst'`, `'domFirst'`, `'blueprintFirst'`, `'merge'`) and precedence resolution.
  - [x] `src/storage/with-storage.test.ts`: Test pure lazy `withStorage(options)` operator registration.
- [x] **TDD Step 2: Storage Adapters & Hydration Implementation** (`src/storage/adapters.ts`, `src/storage/hydration.ts`, `src/storage/with-storage.ts`):
  - [x] Implement adapters in `src/storage/adapters.ts`.
  - [x] Implement hydration engine in `src/storage/hydration.ts`.
  - [x] Implement `withStorage` in `src/storage/with-storage.ts`.
  - [x] Verify 100% green tests via `npm test`.

### 3.2 Storage Fault Tolerance & Cross-Tab Sync

- [x] **TDD Step 1: Fault Tolerance & Sync Tests** (`src/storage/sync.test.ts`):
  - [x] `src/storage/sync.test.ts`: Test corrupted JSON resilience (dispatching `InvalidStorageDataError` to error stream with safe fallback to initial state), cross-tab sync (`window.addEventListener('storage')` and `BroadcastChannel`), and W3C Web Locks API coordination (`navigator.locks.request`).
- [x] **TDD Step 2: Fault Tolerance & Sync Implementation** (`src/storage/sync.ts`):
  - [x] Implement sync coordinator and fault tolerance in `src/storage/sync.ts`.
  - [x] Verify 100% green tests via `npm test`.

---

## Milestone 4: P1 Async DI, Multi-Provider & Keyed Resuscitation

The goal of Milestone 4 is to implement advanced async service resolution, multi-provider accumulation pipelines, and Keyed 50ms resuscitation state machines using strict TDD.

### 4.1 Async Dependency Injection (`injectAsync` & `mountAsync`)

- [x] **TDD Step 1: Async DI Tests** (`src/core/async-provider.test.ts`, `src/dom/inject-async.test.ts`, `src/core/mount-async.test.ts`):
  - [x] `src/core/async-provider.test.ts`: Test lazy `withAsyncProvider` operator, Promise type inference, and async registration.
  - [x] `src/dom/inject-async.test.ts`: Test `injectAsync(token, options)(target)` with Promise Coalescing, self-healing cache eviction on rejection, synchronous/asynchronous guard (`AsyncServiceNotReadyError`), DFS directed cycle detection (`CircularDependencyError`), and multi-caller abort isolation.
  - [x] `src/core/mount-async.test.ts`: Test `mountAsync(blueprint)(element)` blocking async mount awaiting storage hydration and eager async providers.
- [x] **TDD Step 2: Async DI Implementation** (`src/core/async-provider.ts`, `src/dom/inject-async.ts`, `src/core/mount-async.ts`):
  - [x] Implement `withAsyncProvider` in `src/core/async-provider.ts`.
  - [x] Implement `injectAsync` in `src/dom/inject-async.ts`.
  - [x] Implement `mountAsync` in `src/core/mount-async.ts`.
  - [x] Verify 100% green tests via `npm test`.

### 4.2 Multi-Provider Accumulation Protocol (`injectAll` & `injectAllAsync`)

- [x] **TDD Step 1: Multi-Provider Accumulation Tests** (`src/dom/inject-all.test.ts`):
  - [x] `src/dom/inject-all.test.ts`: Test `injectAll(token, options)(target)` continuous bubbling accumulation (`{ multi: true }`), direction ordering (`bottomUp` vs `topDown`), and `injectAllAsync` concurrent resolution via `Promise.all()`.
- [x] **TDD Step 2: Multi-Provider Accumulation Implementation** (`src/dom/inject-all.ts`):
  - [x] Implement `injectAll` and `injectAllAsync` in `src/dom/inject-all.ts`.
  - [x] Verify 100% green tests via `npm test`.

### 4.3 Keyed Identity & 50ms Grace Period Resuscitation State Machine

- [x] **TDD Step 1: Keyed Resuscitation Tests** (`src/core/resuscitation.test.ts`):
  - [x] `src/core/resuscitation.test.ts`: Test `data-context-key` host element identification, `Phase 4: Suspended` state transition with 50ms TTL timer, Dirty Queue write buffering, `Phase 5: Resuscitated` re-connection and dirty queue flushing, `resuscitate` hook execution, and TTL timeout transition to `Phase 6: Disposed`.
- [x] **TDD Step 2: Keyed Resuscitation Implementation** (`src/core/resuscitation.ts`):
  - [x] Implement resuscitation state machine and Dirty Queue in `src/core/resuscitation.ts`.
  - [x] Verify 100% green tests via `npm test`.

---

## Milestone 5: P2 Ecosystem, TC39 Standards & Verification

The goal of Milestone 5 is to deliver fine-grained TC39 Signals interoperability, TC39 Decorators, and comprehensive end-to-end verification using strict TDD.

### 5.1 TC39 Standards & Ecosystem Bridges

- [x] **TDD Step 1: TC39 Signals & Decorators Tests** (`src/signals/to-signal.test.ts`, `src/core/decorators.test.ts`):
  - [x] `src/signals/to-signal.test.ts`: Test `toSignal(session, selector)` returning `Signal.Computed` and fine-grained reactive updates.
  - [x] `src/core/decorators.test.ts`: Test TC39 Stage 3 decorators `@provide(token, options)` and `@inject(token)`, and `provideClass(token, ClassConstructor)`.
- [x] **TDD Step 2: TC39 Signals & Decorators Implementation** (`src/signals/to-signal.ts`, `src/core/decorators.ts`):
  - [x] Implement `toSignal` in `src/signals/to-signal.ts`.
  - [x] Implement decorators in `src/core/decorators.ts`.
  - [x] Verify 100% green tests via `npm test`.

### 5.2 Full Test Suite & CI Quality Gate Verification

- [x] Run full automated test suite: `npm test` (vitest 100% pass across all `src/**/*.test.ts`).
- [x] Run build pipeline: `npm run build` (tsdown ESM + .d.ts generation).
- [x] Validate 1:1 test co-location compliance across all `src/**/*.ts` source files.

---

## Task Progress Checklist

| Milestone | Category                         | Status       | Primary Test Files (`*.test.ts`)                                                                                                                                  | Primary Source Files (`*.ts`)                                                                                                            |
| :-------- | :------------------------------- | :----------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| **M0**    | Core Foundation & Types          | 🟢 Completed | `src/core/types.test.ts`, `src/core/errors.test.ts`                                                                                                               | `src/core/types.ts`, `src/core/errors.ts`                                                                                                |
| **M0**    | Core Blueprint Operators         | 🟢 Completed | `src/core/context.test.ts`, `src/core/pipe.test.ts`, `src/core/providers.test.ts`, `src/core/hooks.test.ts`                                                       | `src/core/context.ts`, `src/core/pipe.ts`, `src/core/providers.ts`, `src/core/hooks.ts`                                                  |
| **M0**    | Runtime Session & State Verbs    | 🟢 Completed | `src/core/mount.test.ts`, `src/core/select.test.ts`, `src/core/update.test.ts`, `src/core/subscribe.test.ts`, `src/core/dispose.test.ts`                          | `src/core/mount.ts`, `src/core/select.ts`, `src/core/update.ts`, `src/core/subscribe.ts`, `src/core/dispose.ts`                          |
| **M1**    | DOM Scope, W3C Protocol & GC     | 🟢 Completed | `src/dom/events.test.ts`, `src/dom/inject.test.ts`, `src/dom/observer.test.ts`                                                                                    | `src/dom/events.ts`, `src/dom/inject.ts`, `src/dom/observer.ts`                                                                          |
| **M2**    | Bidirectional Property Bridge    | 🟢 Completed | `src/bridge/property-path.test.ts`, `src/bridge/with-bridge.test.ts`, `src/bridge/sanitize.test.ts`, `src/bridge/loop-guard.test.ts`                              | `src/bridge/property-path.ts`, `src/bridge/with-bridge.ts`, `src/bridge/sanitize.ts`, `src/bridge/loop-guard.ts`                         |
| **M3**    | State Persistence & Hydration    | 🟢 Completed | `src/storage/adapters.test.ts`, `src/storage/hydration.test.ts`, `src/storage/with-storage.test.ts`, `src/storage/sync.test.ts`                                   | `src/storage/adapters.ts`, `src/storage/hydration.ts`, `src/storage/with-storage.ts`, `src/storage/sync.ts`                              |
| **M4**    | Async DI, Multi-Provider & Keyed | 🟢 Completed | `src/core/async-provider.test.ts`, `src/dom/inject-async.test.ts`, `src/core/mount-async.test.ts`, `src/dom/inject-all.test.ts`, `src/core/resuscitation.test.ts` | `src/core/async-provider.ts`, `src/dom/inject-async.ts`, `src/core/mount-async.ts`, `src/dom/inject-all.ts`, `src/core/resuscitation.ts` |
| **M5**    | Signals, Decorators & Release    | 🟢 Completed | `src/signals/to-signal.test.ts`, `src/core/decorators.test.ts`                                                                                                    | `src/signals/to-signal.ts`, `src/core/decorators.ts`                                                                                     |
