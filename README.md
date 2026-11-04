# @sandlada/document-context

![npm version](https://img.shields.io/npm/v/@sandlada/document-context?label=NPM%20Version&labelColor=%23223625&color=%23a0fab0)
![GitHub License](https://img.shields.io/github/license/sandlada/document-context?label=License&labelColor=%23223625&color=%23a0fab0)
[![coverage](https://img.shields.io/badge/coverage-95.0%25-a0fab0?labelColor=223625&label=coverage)](./packages/document-context/coverage/index.html)

Function-first IoC and reactive state anchored to **physical DOM hosts**. v0.1.0 uses a **layered** architecture (`domain` / `application` / `infrastructure`), **RxJS-first** streams, and **late-binding** dependency resolution (`inject` and `mount` order does not matter).

- **Physical DOM as scope hierarchy** — resolve along the ancestor chain; no virtual scope trees.
- **Zero-leak lifecycle** — sessions, subscriptions, and observers align with host connection; keyed resuscitation with TTL.
- **W3C Context Protocol** — cross-bundle DI via `context-request` and normative mount/dispose events.
- **SSR-safe core** — domain loads in Node; default root entry wires DOM adapters lazily.
- **No built-in DOM projection** — map state to the DOM with `subscribe$` / `select$` + your own DOM code ([recipes](./docs/next-version/08-projection.md)).

Design specs: [`docs/next-version`](./docs/next-version/README.md). Migration from v0.0.1: [`docs/next-version/11-migration.md`](./docs/next-version/11-migration.md).

---

## Installation

```bash
npm install @sandlada/document-context rxjs
```

RxJS is a **required** peer dependency (`^7.8.0 || ^8.0.0`).

---

## Quick start

Mount when the host is **connected** (for example inside `connectedCallback`):

```ts
import {
    createContext,
    defineToken,
    mount,
    persist,
    pipe,
    provideSync,
    subscribe$,
    update,
} from '@sandlada/document-context'

const logToken = defineToken<{ log: (message: string) => void }>('app:logger')

const blueprint = pipe(
    createContext({ count: 0 }),
    provideSync(logToken, () => ({
        log: (message: string) => console.log(message),
    })),
    persist({ storage: 'localStorage', key: 'counter', version: 1 }),
)

const host = document.getElementById('counter-box')!
const session = await mount(blueprint)(host)

subscribe$((state) => {
    host.dataset.count = String(state.count)
})(session)

update((state) => ({ count: state.count + 1 }))(session)
```

Package subpaths:

| Import | Use |
| :--- | :--- |
| `@sandlada/document-context` | Default wired API (composition root) |
| `@sandlada/document-context/application` | `createApplication` + verbs with custom ports |
| `@sandlada/document-context/domain` | Ports, models, tokens |
| `@sandlada/document-context/infrastructure/dom` | DOM adapters |
| `@sandlada/document-context/infrastructure/storage` | Storage adapters |
| `@sandlada/document-context/infrastructure/ssr` | SSR helpers |

Second-tier sync projections (`mountSync`, `injectSync`, `selectSync`, …) exist in `0.1.x` but are **deprecated**; prefer async `mount` / `inject` / `inject$`.

---

## Monorepo layout

| Path | Role |
| :--- | :--- |
| [`packages/document-context`](./packages/document-context) | Publishable library (`0.1.0-alpha.0`) |
| [`packages/demo`](./packages/demo) | Vite multi-page demo |
| [`site/`](./site) | Starlight docs (legacy `0.0.1` snapshot; site refresh is P1) |
| [`docs/archive/v0.0.1`](./docs/archive/v0.0.1) | Historical v0.0.1 design docs |

---

## Development

```bash
pnpm install
pnpm test          # vitest in packages/document-context
pnpm run build     # tsdown → packages/document-context/build
pnpm run demo:dev  # demo at http://localhost:5173
```

Node **≥ 22.12**.

Historical v0.0.1 sources were removed from `src/`; see [`docs/archive/v0.0.1`](./docs/archive/v0.0.1).
