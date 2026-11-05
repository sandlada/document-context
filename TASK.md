# Project Tasks & Execution Roadmap (TASK.md) — v0.1.0 (next generation)

Execution tracking for `@sandlada/document-context`. This file covers **two tracks**:

| Track | State | Corpus |
| :--- | :--- | :--- |
| **Legacy implementation** (`0.1.0-alpha.0`) | Retired in git history (see `4f0b70c`) | Retired — removed in N3 cutover |
| **Next generation** (`0.0.2-20261105.a`) | **Landed & Cutover** in [`packages/document-context/`](./packages/document-context) (`0.0.2-20261105.a`) | [`docs/archive/0.0.2/`](./docs/archive/0.0.2/README.md) |

The next generation is designed **before** it is coded. [`docs/archive/0.0.2/`](./docs/archive/0.0.2/README.md) is the single source of truth for behaviour; concrete TypeScript types, module layout and export map are decided at implementation time.

---

## Track N — next generation

### N0 — Design corpus ✅ in progress

| Item | Status |
| :--- | :--- |
| Product positioning, two-phase model, non-goals ([`00`](./docs/archive/0.0.2/00-overview.md)) | ✅ |
| Public API surface ([`01`](./docs/archive/0.0.2/01-api.md)) | ✅ |
| Lifecycle & hooks ([`02`](./docs/archive/0.0.2/02-lifecycle.md)) | ✅ |
| DOM scope & host ([`03`](./docs/archive/0.0.2/03-dom.md), [`09`](./docs/archive/0.0.2/09-mount-host.md)) | ✅ |
| Promise / lazy load ([`04`](./docs/archive/0.0.2/04-promise-lazy.md)) | ✅ |
| SSR ([`05`](./docs/archive/0.0.2/05-ssr.md)) | ✅ |
| Tokens & multi-bundle ([`07`](./docs/archive/0.0.2/07-tokens.md)) | ✅ |
| Injection lifecycles ([`08`](./docs/archive/0.0.2/08-injection.md)) | ✅ |
| Context Protocol events ([`10`](./docs/archive/0.0.2/10-events.md)) | ✅ |
| Composition root & ports ([`11`](./docs/archive/0.0.2/11-composition.md)) | ✅ |
| Gap review ([`REVIEW`](./docs/archive/0.0.2/REVIEW.md)) | ✅ |

### N1 — Close the gaps ✅ done

Items identified by the review, resolved in the corpus:

- [x] Error taxonomy consolidated ([`12-errors.md`](./docs/archive/0.0.2/12-errors.md)); `01` §1.6 reduced to a pointer.
- [x] RxJS semantics specified ([`13-reactivity.md`](./docs/archive/0.0.2/13-reactivity.md)).
- [x] Ports contract + pluggable connectivity ([`14-ports.md`](./docs/archive/0.0.2/14-ports.md)).
- [x] Testing strategy & invariant IDs ([`15-testing.md`](./docs/archive/0.0.2/15-testing.md)).
- [x] Packaging & release contract ([`16-packaging.md`](./docs/archive/0.0.2/16-packaging.md)).
- [x] Migration guide from the legacy line ([`17-migration.md`](./docs/archive/0.0.2/17-migration.md)).
- [x] Usage recipes ([`18-recipes.md`](./docs/archive/0.0.2/18-recipes.md)).
- [x] Contract contradictions across `01`–`11` adjudicated (see [`REVIEW.md`](./docs/archive/0.0.2/REVIEW.md) §4).
- [x] Type definitions moved **out** of the design phase — the corpus fixes semantics and behaviour; TypeScript shapes are decided at implementation time.

### N2 — Implementation ✅ landed (`0.0.2-20261105.a`)

- [x] Decide the public type surface (naming, generics, branded tokens) — **development-time decision**, not a design-doc output.
- [x] Decide the `pipe` type-inference strategy.
- [x] Scaffold `packages/document-context`: `domain` ← `application` ← `infrastructure`, `tsdown`, `vitest` projects, fake ports.
- [x] Implement Phase 1 (blueprint) with unit tests.
- [x] Implement Phase 2 (mount / session lifecycle) with unit + integration tests.
- [x] Implement the DOM adapter (observer, scope transport, Context Protocol).
- [x] Implement the SSR adapter.
- [x] Implement the composition root and the root entry.
- [x] Publish candidate: `0.0.2-20261105.a`.

**State**: 40 test files / 182 tests green (unit → integration → e2e); `typecheck`, `typecheck:build`, `typecheck:test` and `tsdown` all pass. Source: [`packages/document-context/src`](./packages/document-context/src).

Decisions taken at implementation time (all recorded in the package README and the corpus):

| Topic | Decision |
| :--- | :--- |
| Single vs. multi registrations | Two pools; a `multi: true` registration never answers a single-value `inject` ([`01`](./docs/archive/0.0.2/01-api.md) §1.4) |
| `detail.callback` argument | The value, or a Promise of it when the provider factory is asynchronous ([`10`](./docs/archive/0.0.2/10-events.md) §10.1.4) |
| Cross-bundle resolution | The scope transport declares `authoritative`; the DOM transport is not, so a miss asks the Context Protocol bus ([`14`](./docs/archive/0.0.2/14-ports.md) §14.4) |
| Provider index | Lives on the document, not on the module |
| New error code | `FOREIGN_SESSION` for cross-application session operations ([`12`](./docs/archive/0.0.2/12-errors.md) §12.3) |
| Size budget | `./application` / `./infrastructure/ssr` move to 12 KB each after measurement ([`16`](./docs/archive/0.0.2/16-packaging.md) §16.4.1.1) |

### N3 — Cutover ✅ done

- [x] Flip root scripts in `package.json` from `@sandlada/document-context-deprecated` back to `@sandlada/document-context`.
- [x] Flip CI artifact verification to `packages/document-context/build`.
- [x] Remove `packages/document-context-deprecated` and the demo's legacy pages.
- [x] Remove `"private": true` from `packages/document-context/package.json` and restore `publishConfig`.
- [x] Regenerate `pnpm-lock.yaml` and README badges.

---

## Track L — legacy implementation (frozen)

| Milestone | Scope | Status |
| :--- | :--- | :--- |
| **M0** | Workspace, build/test, domain ports, tokens, errors | Done |
| **M1** | Domain models, use cases, late-binding state machine | Done |
| **M2** | Application API, `createApplication`, fake-port tests | Done |
| **M3** | infrastructure/dom: host, observer, late-binding, attach | Done |
| **M4** | infrastructure/storage + `persist` wiring | Done |
| **M5** | Keyed sessions, resuscitation, injectAll family | Done |
| **M6** | infrastructure/ssr: payload, serialize, hydration | Done |
| **M7** | Repo cutover, CI, README/AGENTS/CHANGELOG, publish gates | Superseded by track N |

- [x] Remove legacy root `src/`; publish from `packages/document-context` only.
- [x] pnpm workspace; root scripts delegate to the library.
- [x] CI builds and verifies the library build subpaths.
- [x] Archive v0.0.1 design docs (now the Starlight snapshot in `packages/site`).
- [x] Package README, LICENSE, CHANGELOG (root symlinks); rewrite `AGENTS.md` for layered layout.
- [x] Move the legacy implementation to `packages/document-context-deprecated` and rename the package to `@sandlada/document-context-deprecated` (keeps the workspace free of duplicate package names).
- [x] Playwright e2e for closed shadow DOM and browser-level lifecycle/scope limitations (PW-1 ~ PW-6).
- [ ] Starlight site refresh for `0.1.x` (P1; the legacy `0.0.1` site remains).

### N4 — Phase 3: Real Browser E2E Suite (Playwright) ✅ landed

- [x] Configure Playwright targeting Chromium with local Vite dev server harness.
- [x] `PW-1`: closed shadow root external accessibility and `composed` event penetration / nearest-wins resolution across closed shadow boundary (`test/browser/pw-1-closed-shadow.spec.ts`).
- [x] `PW-2`: `document.adoptNode` across documents, `isConnected` fact update, and `onAdopt` timing (`test/browser/pw-2-adopt-node.spec.ts`).
- [x] `PW-4` / `PW-5`: real browser microtask checkpoint, `MutationObserver` disconnection verification, and reconnection within microtask checkpoint (reparenting) vs suspended / disposed (`test/browser/pw-4-5-lifecycle-microtask.spec.ts`).
- [x] `PW-6`: cross-`iframe` document boundary scope isolation (`SCOPE #2`) (`test/browser/pw-6-cross-iframe.spec.ts`).
- [x] Add `test:browser` and `test:e2e:browser` to package and workspace scripts.

---

## Development commands

```bash
pnpm install
pnpm test              # vitest projects (unit / integration / e2e)
pnpm run test:browser  # playwright real browser e2e
pnpm run build         # tsdown → packages/document-context/build
pnpm run typecheck
pnpm run demo:dev
```

Sources and unit tests for `@sandlada/document-context` live in `packages/document-context/src/**` with `*.unit-test.ts` co-located 1:1 with source files; integration tests live in `packages/document-context/test/integration/`, e2e tests in `packages/document-context/test/e2e/`, and browser tests in `packages/document-context/test/browser/`.
