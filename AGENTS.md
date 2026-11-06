# AGENTS.md

System instructions and coding conventions for AI agents working on `@sandlada/document-context` **v0.1.0** (layered monorepo).

> **Reference documents**
> - **Forward API design**: [`docs/archive/0.0.2/`](./docs/archive/0.0.2/README.md) — the **single source of truth** for the next generation (`0.1.x`): SSR, lifecycle, hooks, Promise, lazy load. It describes the product to be built, not code that exists yet.
> - **Design review**: [`docs/archive/0.0.2/REVIEW.md`](./docs/archive/0.0.2/REVIEW.md) — gap analysis and architecture recommendations for the corpus above.
> - **Legacy implementation**: retired in git history (`git show 4f0b70c:…` or tag `v0.1.0-alpha.0`); the previous implementation was removed during the N3 cutover.
> - **Roadmap & cutover**: [`TASK.md`](./TASK.md).
> - **v0.0.1 history only**: the Starlight snapshot in [`packages/site/`](./packages/site) — not a compatibility contract.

---

## 1. Project overview

The next generation ships from [`packages/document-context`](./packages/document-context). Canonical **README**, **CONTRIBUTING**, **LICENSE**, **CHANGELOG**, **CODE_OF_CONDUCT**, and **SECURITY** live in that directory; repository root copies are **symlinks** for GitHub and npm discovery—edit the package files only.

> **Current phase**: the next generation is **landed and cut over** in [`packages/document-context`](./packages/document-context) (`0.0.2-20261105.a`) against [`docs/archive/0.0.2/`](./docs/archive/0.0.2/README.md) — `domain` ← `application` ← `infrastructure`, one composition root, three vitest projects. Root verification scripts target `@sandlada/document-context`.

The library is a **function-first, DOM-hosted IoC and reactive state** package with:

1. **Physical DOM as scope** — ancestry-chain resolution; W3C Context Protocol transport in infrastructure.
2. **Zero-leak lifecycle** — centralized observer, keyed suspension/resuscitation, abort-bounded subscriptions.
3. **RxJS first-class** — `state$`, `errors$`, `lifecycle$`; required peer `rxjs`.
4. **Strict layering** — `domain` (zero DOM) ← `application` ← `infrastructure`; **single composition root** at `packages/document-context/src/index.ts` wires adapters into `createApplication({ host, ssr? })`. Do **not** frame the product as “hexagonal architecture” in user-facing copy; the maintainer story is **function-first API + two-phase model + ports at the composition root** (aligned with [`docs/archive/0.0.2/`](./docs/archive/0.0.2/README.md) `00`–`11`). Functional data-last verbs and ports are complementary; **`application` must not import infrastructure** (no DOM-adapter shortcuts).
5. **Domain ports** — `HostPort`, `SchedulerPort`, `ScopeTransportPort` (and tests via fake ports). Implementation detail lives under `packages/document-context/src/domain/ports` and `infrastructure/*`.
6. **Late-binding DI** — `inject` / `inject$` / `injectAll`; the legacy `*Sync` tier is **removed** in the next generation, not deprecated.
7. **No built-in DOM bridge** — the library provides state and lifecycle; users compose DOM updates via streams (see [01-api §1.7](./docs/archive/0.0.2/01-api.md)).

### Two-phase model

- **Phase 1 (pure blueprint)**: `createContext`, `pipe`, `provide`, `onMount`, … — zero DOM, zero I/O.
- **Phase 2 (mount boundary)**: `mount(blueprint, options?)(host)` → `Session` (synchronous handle); infrastructure activates adapters on the host. `await session.ready` reports initialization completion.

### Data-last currying

Runtime verbs and blueprint operators: `operation(config)(target)`. Seeds (`createContext`), composition (`pipe`), token definitions, and pure helpers (`merge`) are the documented exceptions.

```ts
import {
    createContext,
    defineToken,
    inject,
    mount,
    pipe,
    provide,
    subscribe$,
    update,
} from '@sandlada/document-context'

const blueprint = pipe(
    createContext({ count: 0 }),
    provide(countToken, ({ session }) => ({ /* … */ })),
)

const session = mount(blueprint)(document.getElementById('app')!)
await session.ready
subscribe$((state) => { /* DOM recipe */ })(session)
update((s) => ({ count: s.count + 1 }))(session)
```

### Tokens

Use `defineToken<T>('public')('namespace:name')` or `defineToken<T>('private')(name)` and `ServiceRegistry` declaration merging (see [07-tokens](./docs/archive/0.0.2/07-tokens.md)). `inject<T>` carries the service type. Keyed identity uses `mount(bp, { token })`. `definePrivateToken` is **retired**.

### Package exports

Root `.` re-exports wired verbs. The subpath map is **fixed**: `.`, `./application`, `./domain`, `./infrastructure/dom`, `./infrastructure/ssr`, `./package.json` (see [11-composition §11.4](./docs/archive/0.0.2/11-composition.md) and [16-packaging §16.1](./docs/archive/0.0.2/16-packaging.md)). The legacy `./infrastructure/storage` subpath has no counterpart in the next generation — storage is explicitly out of scope.

---

## 2. Development commands

```bash
pnpm install
pnpm test        # vitest projects (unit / integration / e2e)
pnpm run build   # tsdown → packages/document-context/build
pnpm run typecheck
pnpm run site:dev
```

- Single file: `pnpm exec vitest run --project unit path/to/file.unit-test.ts` (from `packages/document-context`, or `--project integration` / `--project e2e`)
- Filter: `pnpm exec vitest run -t "pattern"` (from `packages/document-context`)

Package-level checks (from `packages/document-context`):

```bash
pnpm exec vitest run                          # unit → integration → e2e (40 files / 182 tests)
pnpm exec tsc --noEmit -p tsconfig.json       # source types
pnpm exec tsc --project tsconfig.build.json --noEmit
pnpm exec tsc --project tsconfig.test.json --noEmit
pnpm exec tsdown                              # build → packages/document-context/build
```

---

## 3. Agent invariants

1. **TDD**: Red → Green → Refactor. Tests before implementation.
2. **Test organization**:
   - `src/**/*.unit-test.ts` — node environment, 1:1 co-located with source files (fast feedback, zero DOM); exceptions: pure `index.ts` re-exports, `.d.ts`.
   - `test/integration/**/*.integration-test.ts` — happy-dom environment, multi-module and DOM/SSR host adapter integration tests.
   - `test/e2e/**/*.e2e-test.ts` — happy-dom environment, end-to-end flow verification.
   - `test/browser/**/*.spec.ts` — real browser tests via Playwright (closed shadow DOM, microtask reparenting, cross-iframe).
3. **Layer rules**: domain must not import application/infrastructure or touch DOM globals; application must not import infrastructure (composition root only).
4. **Style**: no trailing semicolons; 4 spaces; single quotes; LF.
5. **Pure blueprint operators** — no side effects in Phase 1 operators.
6. **Data-last** public APIs; no container classes / no `this` in public surface.
7. **RxJS**: do not leak internal operators; public surface may expose `Observable` / `Subscription` types where documented.
8. **TypeScript**: `strict`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, target ES2022. The concrete type surface is settled **at development time** — the design corpus fixes *semantics*, not TS syntax.
9. **Never edit** committed `build/` artifacts.
10. **TSDoc** on public implementation signatures: description, `@param`, `@returns`, `@throws`, honest `@example` (runnable against package entry). Document actual behavior only; mark P1-reserved fields explicitly.

---

## 4. Lifecycle invariants (summary)

- DOM disconnect: microtask reparent check before dispose; keyed sessions → `Suspended` with TTL; anonymous → dispose path per spec.
- Disposed sessions: `update` no-ops; resolution throws `DISPOSED_SESSION` where specified.
- Async providers: in-flight coalescing; reject evicts cache for retry.
- Internal subscriptions: abort-bounded pattern in application/infrastructure wiring.

Full matrices: [02-lifecycle](./docs/archive/0.0.2/02-lifecycle.md), [04-promise-lazy](./docs/archive/0.0.2/04-promise-lazy.md).

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
