# AGENTS.md

This file provides system instructions, architectural invariants, and strict coding conventions for AI agents working on `@sandlada/document-context`.

> **Reference Documents**:
> - **Architecture & Philosophy**: See [`DESIGN.md`](./DESIGN.md) for full design rationale, architectural comparisons, and technical specifications.
> - **Project Plan & Roadmap**: See [`TASK.md`](./TASK.md) for milestone tasks, task checklists, and execution status.

---

## 1. Project Overview & Core Architecture

`@sandlada/document-context` is a browser-side ESM package providing a **function-first, DOM-anchored Inversion of Control (IoC) container and reactive state management library** hosted on `HTMLElement` and physical DOM nodes.

### 1.1 Four Core Pillars

1. **Physical DOM as Scope Hierarchy (空間即作用域)**:
   The physical nesting of the DOM tree maps directly to IoC container scope hierarchies. Resolving dependencies automatically walks up `parentElement`, eliminating manual virtual container trees in JavaScript heap memory.
2. **Zero-Leak DOM Lifecycle Co-location (零洩漏生命週期對齊)**:
   Container and state lifecycles are co-located with real DOM nodes. Detaching a node from the DOM automatically triggers garbage collection, subscription cleanup, and resource disposal (with grace period / resuscitation support).
3. **Reactive Co-location & Bidirectional Bridge (視圖與狀態原子級共生)**:
   DOM nodes act both as dependency holders and physical projections of reactive state. The built-in bidirectional property bridge synchronizes JS state and DOM properties (`dataset.*`, `style.*`, `aria-*`, `value`) with loop guards.
4. **Framework-Agnostic Lingua Franca (與框架無關的原生公共契約)**:
   Built on native browser standards (`HTMLElement`, Custom Events, W3C Context Protocol). Serves as a shared communication and state bus across bundle boundaries, micro-frontends, Astro / Islands architectures, Web Components, and mixed frameworks.

### 1.2 Two-Phase Execution Architecture

```
[Phase 1: Pure & Lazy Blueprint Declaration]          [Phase 2: Mount Execution Boundary]
  Define schema, compose operators & providers         Pass physical DOM element, activate runtime
 (Zero DOM, Zero I/O, Zero Listeners, Pure Data)     (WeakMap cache, EventListeners, MutationObserver)
                    │                                                        │
                    ▼                                                        ▼
createContext() ──> pipe(withProvider, withBridge) ──────────> mount(blueprint)(element)
```

- **Phase 1: Pure Lazy Blueprint**: `createContext()` and operators (`withProvider`, `withBridge`, `withStorage`, `pipe`) are 100% pure in-memory data compositions. Zero DOM access, zero I/O, zero event listeners.
- **Phase 2: Mount Execution Boundary**: `mount(blueprint)(element)` activates the runtime on physical DOM nodes, initializing stores, event listeners, and MutationObservers.

### 1.3 Data-Last (Curried) API Paradigm

All operation verbs strictly follow the curried `operation(config)(target)` signature:

```ts
import { 
    createContext, 
    withProvider, 
    withBridge, 
    withStorage, 
    mount, 
    select, 
    update, 
    inject,
    pipe 
} from '@sandlada/document-context'

// 1. Pure Lazy Blueprint
const counterBlueprint = pipe(
    createContext({ count: 0, theme: 'light' as 'light' | 'dark' }),
    withProvider('logger', () => new ConsoleLogger(), { lifecycle: 'singleton' }),
    withBridge({ properties: { count: 'dataset.count' } }),
    withStorage({ adapter: 'localStorage', key: 'counter-app' })
)

// 2. Mount Execution Boundary
const mountCounter = mount(counterBlueprint)
const session = mountCounter(document.getElementById('counter-box')!)

// 3. Data-Last Operations
const selectCount = select((s: { count: number }) => s.count)
const currentCount = selectCount(session)

const increment = update<{ count: number }>((s) => ({ count: s.count + 1 }))
increment(session)

const useLogger = inject('logger')
const logger = useLogger(session) // or useLogger(childElement)
```

### 1.4 String Token & `ServiceRegistry` First-Class Support

String tokens are first-class citizens with full TypeScript type safety via declaration merging:

```ts
// In env.d.ts or context.d.ts
declare module '@sandlada/document-context' {
    interface ServiceRegistry {
        'auth-service': AuthService
        'cart-store': CartStore
        'theme-mode': 'light' | 'dark'
    }
}

// In component / script
import { inject } from '@sandlada/document-context'

const auth = inject('auth-service')(document.getElementById('login-btn')!)
auth.login()
```

### 1.5 Modular Subpath Structure

- `@sandlada/document-context/core`: Core container, `createContext`, `pipe`, `mount`, `inject`, `select`, `update`, `subscribe`.
- `@sandlada/document-context/bridge`: `withBridge` (DOM bidirectional property synchronization).
- `@sandlada/document-context/storage`: `withStorage` (persistence adapters).
- `@sandlada/document-context/dom`: DOM tree traversal, W3C Context Protocol (`context-request`), and `MutationObserver` watcher.

### 1.6 Four-Dimension Multi-Lifecycle Architecture (四維多生命周期體系)

The system strictly decouples and coordinates four orthogonal lifecycle dimensions:

```
1. 物理 DOM 宿主生命周期 (Physical DOM Lifecycle - W3C Standard)
   Unconnected ──> Connected ──> Adopted ──> Disconnected ──> GC Collected

2. 會話執行期狀態機生命周期 (Session State Machine Lifecycle)
   Phase 1: Blueprint ──> Phase 2: Initializing ──> Phase 3: Mounted ──>
   Phase 4: Suspended (TTL) ──> Phase 5: Resuscitated ──> Phase 6: Disposed

3. 依賴與服務解析生命周期 (Service & IoC Scope Lifecycle)
   Singleton ⇋ Scoped ⇋ Transient | Lazy vs Eager | In-Flight ➔ Resolved ➔ Evicted

4. 狀態、橋接與存儲生命周期 (Reactive State, Bridge & Storage Lifecycle)
   Blueprint Seed ──> Hydration Precedence ──> Reactive Flow ──> Txn Lock ──> Finalized
```

- **Invariants**:
  - DOM unmount must NOT prematurely destroy Session without Microtask reparenting check.
  - Keyed Sessions entering `Suspended` pause DOM writes into a Dirty Queue while keeping the memory store alive for up to 50ms TTL.
  - Disposed Sessions silently No-op on subsequent `update()` calls to prevent unhandled rejections from dangling async closures.
  - In-flight async provider promises must be coalesced and evicted immediately upon rejection for self-healing retries.

---

## 2. Development Commands

```bash
npm run build   # tsdown → ./build (ESM + .d.ts, cleans outDir first)
npm test        # vitest run (src/**/*.test.ts, happy-dom env)
```

- Run a specific test file: `npx vitest src/core/mount.test.ts`
- Run by test name filter: `npx vitest -t "withBridge"`
- Watch mode: `npx vitest`

---

## 3. Strict Coding Conventions & Agent Invariants

AI agents must strictly adhere to the following rules across all generated and modified code:

1. **Test-First / TDD Mandate (測試優先 / 測試驅動開發絕對原則)**:
   - **Strict Order of Execution**: Before writing any implementation code in a `*.ts` file, the agent **MUST** write the corresponding test cases in `*.test.ts` first!
   - **TDD Cycle (Red-Green-Refactor)**:
     1. **Step 1 (Red / 測試先行)**: Create or update the sibling `*.test.ts` file. Formulate comprehensive test suites asserting behavior, edge cases, error conditions, and lifecycle invariants according to design specifications.
     2. **Step 2 (Green / 最小實現)**: Write the minimal implementation in `*.ts` to make all tests pass (`npm test` / `npx vitest <file>.test.ts`).
     3. **Step 3 (Refactor / 重構驗證)**: Refactor and optimize the implementation while maintaining 100% test pass rate.
   - **Zero Untested Code**: Writing business logic or library features without prior or accompanying `*.test.ts` unit tests is strictly forbidden.
2. **Test File Co-location & 1:1 Mapping (同級測試與 1:1 對應)**:
   - Test files use the `*.test.ts` suffix and **MUST** be co-located in the exact same directory/location as their corresponding `*.ts` source file (e.g. `src/core/mount.ts` <-> `src/core/mount.test.ts`).
   - Strict 1:1 mapping: Every `.ts` source file must have a corresponding `.test.ts` test file.
   - Exceptions: `index.ts` (pure re-export aggregators) and pure `.d.ts` declaration files do not require test files.
   - Test execution environment: Happy-DOM in Vitest (`npm test`).
3. **Semicolons**: Strictly **NO trailing semicolons** (`semi: false`) in any TypeScript or JavaScript code.
4. **Indentation**: Exactly **4 spaces** (no tabs, no 2-space indentation).
5. **Quotes & Line Endings**: Single quotes (`'`) for string literals; backticks for template strings. LF line endings (`\n`).
6. **Pure Functions & Immutability**:
   - All public APIs are pure top-level functions (no imperative container classes, no `this`).
   - State stores are strictly immutable.
   - Blueprint operators (`createContext`, `withProvider`, `withBridge`, `withStorage`) must never perform side effects.
7. **Data-Last Currying**:
   - Always implement verbs in curried Data-Last format: `fn(config)(target)`.
8. **String Tokens as First-Class**:
   - Never restrict tokens to `Symbol` or object references; always support string tokens with `ServiceRegistry` type augmentation.
9. **Encapsulation**:
   - RxJS is an internal implementation detail. Never leak internal RxJS classes into the public package interface, except for exported `Observable` / `Subscription` type signatures.
10. **TypeScript Compiler Options**:
    - `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, `noUncheckedSideEffectImports: true`, `verbatimModuleSyntax: true`, `isolatedModules: true`. Target `ES2022`, `moduleResolution: bundler`.
11. **Build Directory**:
    - Never manually edit or commit files in `build/`.



