# Project Tasks & Execution Roadmap (TASK.md) — v0.1.0

Execution tracking for the layered `@sandlada/document-context` package. Deprecated design corpus: [`docs/next-version-deprecated/`](./docs/next-version-deprecated/README.md) (not authoritative over implementation). Historical v0.0.1 tasks: [`docs/archive/v0.0.1/TASK.md`](./docs/archive/v0.0.1/TASK.md).

---

## Milestone status (M0–M7)

| Milestone | Scope | Status |
| :--- | :--- | :--- |
| **M0** | Workspace, build/test, domain ports, tokens, errors | Done |
| **M1** | Domain models, use cases, late-binding state machine | Done |
| **M2** | Application API, `createApplication`, fake-port tests | Done |
| **M3** | infrastructure/dom: host, observer, late-binding, attach | Done |
| **M4** | infrastructure/storage + `persist` wiring | Done |
| **M5** | Keyed sessions, resuscitation, injectAll family | Done |
| **M6** | infrastructure/ssr: payload, serialize, hydration | Done |
| **M7** | Repo cutover, CI, README/AGENTS/CHANGELOG, publish gates | In progress |

---

## M7 — Repository cutover & release gates

- [x] Remove legacy root `src/`; publish from `packages/document-context` only.
- [x] pnpm workspace; root scripts delegate to `@sandlada/document-context`.
- [x] CI builds and verifies `packages/document-context/build/*` subpaths.
- [x] Archive v0.0.1 `DESIGN.md` and top-level docs under `docs/archive/v0.0.1/`.
- [x] Root README and CHANGELOG for v0.1.0; rewrite `AGENTS.md` for layered layout.
- [ ] Optional CI: `publint`, `@arethetypes/wrong`, `size-limit` (see [14-packaging-release.md](./docs/next-version-deprecated/14-packaging-release.md)).
- [ ] Playwright e2e for Closed Shadow DOM (happy-dom e2e tests exist today).
- [ ] Starlight site refresh for v0.1.0 (P1; legacy `0.0.1` site remains).

---

## Development commands

```bash
pnpm install
pnpm test
pnpm run build
pnpm run typecheck
pnpm run demo:dev
```

Tests and sources: `packages/document-context/src/**` with `*.unit-test.ts`, `*.integration-test.ts`, `*.e2e-test.ts` (see [`docs/next-version-deprecated/10-testing.md`](./docs/next-version-deprecated/10-testing.md)).
