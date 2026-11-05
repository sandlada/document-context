# AGENTS.md

System instructions and coding conventions for AI agents working on `@sandlada/document-context` **v0.1.0** (layered monorepo).

> **Reference documents**
> - **Forward API design**: [`docs/next-version/`](./docs/next-version/README.md) — production macro contract (SSR, lifecycle, hooks, Promise, lazy load). Not a description of the code currently in `packages/document-context`.
> - **Architecture & API (deprecated spec)**: [`docs/next-version-deprecated/`](./docs/next-version-deprecated/README.md) — historical blueprint; prefer forward macro + source/tests when they disagree. Deprecated [01-architecture](./docs/next-version-deprecated/01-architecture.md) uses legacy “hexagonal / Clean” wording; **maintainer layering rules** are summarized in AGENTS §1 and [11-composition §11.9](./docs/next-version/11-composition.md).
> - **Roadmap & cutover**: [`TASK.md`](./TASK.md).
> - **v0.0.1 history only**: [`docs/archive/v0.0.1/`](./docs/archive/v0.0.1/README.md) — not a compatibility contract.

---

## 1. Project overview

Publishable code lives in [`packages/document-context`](./packages/document-context). Canonical **README**, **LICENSE**, **CHANGELOG**, **CODE_OF_CONDUCT**, and **SECURITY** also live in that directory; repository root copies are **symlinks** for GitHub and npm discovery—edit the package files only. The library is a **function-first, DOM-hosted IoC and reactive state** package with:

1. **Physical DOM as scope** — ancestry-chain resolution; W3C Context Protocol transport in infrastructure.
2. **Zero-leak lifecycle** — centralized observer, keyed suspension/resuscitation, `abort$`-bounded subscriptions.
3. **RxJS first-class** — `state$`, `errors$`, `lifecycle$`; required peer `rxjs`.
4. **Strict layering** — `domain` (zero DOM) ← `application` ← `infrastructure`; **single composition root** at [`packages/document-context/src/index.ts`](./packages/document-context/src/index.ts) wires adapters into `createApplication({ host, ssr? })`. Do **not** frame the product as “hexagonal architecture” in user-facing copy; the maintainer story is **function-first API + two-phase model + ports at the composition root** (aligned with [`docs/next-version/`](./docs/next-version/README.md) `00`–`11`). Functional data-last verbs and ports are complementary; **`application` must not import infrastructure** (no DOM-adapter shortcuts).
5. **Domain ports** — `HostPort`, `SchedulerPort`, `ScopeTransportPort` (and tests via fake ports). Implementation detail lives under `packages/document-context/src/domain/ports` and `infrastructure/*`.
6. **Late-binding DI** — async-first `inject` / `inject$`; sync `*Sync` verbs are deprecated second-tier projections.
7. **No built-in DOM bridge** — no `withBridge`; users compose DOM updates via streams (see [08-projection](./docs/next-version-deprecated/08-projection.md)).

### Two-phase model

- **Phase 1 (pure blueprint)**: `createContext`, `pipe`, `provide` / `provideSync`, `persist`, `onMount`, … — zero DOM, zero I/O.
- **Phase 2 (mount boundary)**: `mount(blueprint, options?)(host)` → `Session`; infrastructure activates adapters on the host.

### Data-last currying

All verbs: `operation(config)(target)`.

```ts
import {
    createContext,
    defineToken,
    inject,
    mount,
    persist,
    pipe,
    provideSync,
    subscribe$,
    update,
} from '@sandlada/document-context'

const blueprint = pipe(
    createContext({ count: 0 }),
    persist({ storage: 'localStorage', key: 'app', version: 1 }),
)

const session = await mount(blueprint)(document.getElementById('app')!)
subscribe$((state) => { /* DOM recipe */ })(session)
update((s) => ({ count: s.count + 1 }))(session)
```

### Tokens

Use `defineToken<T>('public')('namespace:name')` or `defineToken<T>('private')(name)` and `ServiceRegistry` declaration merging (see [07-tokens](./docs/next-version/07-tokens.md)). `inject<T>` carries the service type. Keyed identity uses `mount(bp, { token })`. `definePrivateToken` is deprecated.

### Package exports

Root `.` re-exports wired verbs. Subpaths: `./domain`, `./application`, `./infrastructure/dom`, `./infrastructure/storage`, `./infrastructure/ssr`.

---

## 2. Development commands

```bash
pnpm install
pnpm test        # packages/document-context — vitest projects (unit / integration / e2e)
pnpm run build   # tsdown → packages/document-context/build
pnpm run typecheck
pnpm run demo:dev
```

- Single file: `pnpm exec vitest --config packages/document-context/vitest.config.ts path/to/file.unit-test.ts`
- Filter: `pnpm exec vitest -t "pattern" --config packages/document-context/vitest.config.ts`

---

## 3. Agent invariants

1. **TDD**: Red → Green → Refactor. Tests before implementation.
2. **Test co-location** (under `packages/document-context/src/`):
   - `*.unit-test.ts` — node environment
   - `*.integration-test.ts` — happy-dom
   - `*.e2e-test.ts` — happy-dom (browser-critical cases may need Playwright later)
   - 1:1 with source files; exceptions: pure `index.ts` re-exports, `.d.ts`.
3. **Layer rules**: domain must not import application/infrastructure or touch DOM globals; application must not import infrastructure (composition root only).
4. **Style**: no trailing semicolons; 4 spaces; single quotes; LF.
5. **Pure blueprint operators** — no side effects in Phase 1 operators.
6. **Data-last** public APIs; no container classes / no `this` in public surface.
7. **RxJS**: do not leak internal operators; public surface may expose `Observable` / `Subscription` types where documented.
8. **TypeScript**: `strict`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, target ES2022.
9. **Never edit** committed `packages/document-context/build/`.
10. **TSDoc** on public implementation signatures: description, `@param`, `@returns`, `@throws`, honest `@example` (runnable against package entry). Document actual behavior only; mark deprecated sync tier and P1-reserved fields explicitly.

---

## 4. Lifecycle invariants (summary)

- DOM disconnect: microtask reparent check before dispose; keyed sessions → `Suspended` with TTL; anonymous → dispose path per spec.
- Disposed sessions: `update` no-ops; resolution throws `DISPOSED_SESSION` where specified.
- Async providers: in-flight coalescing; reject evicts cache for retry.
- Internal subscriptions: `takeUntil(session.abort$)` pattern in application/infrastructure wiring.

Full matrices: [05-lifecycle-host](./docs/next-version-deprecated/05-lifecycle-host.md), [10-testing §10.5](./docs/next-version-deprecated/10-testing.md).

---

## 5. Verification before merge

```bash
pnpm run typecheck
pnpm run typecheck:build
pnpm run typecheck:test
pnpm test
pnpm run build
```

After comment-only API changes, run the same set so examples still type-check.
