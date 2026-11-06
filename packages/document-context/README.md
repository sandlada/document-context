# @sandlada/document-context

![npm version](https://img.shields.io/npm/v/@sandlada/document-context?label=NPM%20Version&labelColor=%23223625&color=%23a0fab0)
![GitHub License](https://img.shields.io/github/license/sandlada/document-context?label=License&labelColor=%23223625&color=%23a0fab0)

Function-first IoC and reactive state anchored to **physical DOM hosts**: a **two-phase** blueprint → `mount` model, **data-last verbs**, and a **ports composition root**. The next generation (`0.1.x`) is a from-scratch reimplementation; its design corpus is the single source of truth.

> **Status — `0.0.2-20261105.a`**
>
> The design corpus in [`docs/archive/0.0.2`](../../docs/archive/0.0.2/README.md) is the single source of truth, and the implementation follows it: `domain` → `application` → `infrastructure`, a single composition root, three vitest projects (unit / integration / e2e) and 182 tests. The legacy implementation has been retired and removed in the N3 cutover.

---

## What it is

A DOM subtree is one piece of state and one dependency table.

- **State belongs to the session** that owns it; a child node never reads another session's state.
- **Dependencies resolve upward** along the host's ancestor chain; the nearest provider wins.
- **Sessions live and die with their host**: removing a node suspends or disposes the session instead of leaving an orphaned subscription behind.

RxJS carries state, errors and lifecycle as streams (required peer dependency). One-shot waits use Promises. Reading "the value right now" uses a synchronous `read`, because the state stream already carries a current value.

## Design principles

| # | Principle |
| :--- | :--- |
| 1 | **Data-last** — `operation(config)(target)`; the value being operated on is always the last argument. |
| 2 | **Phase 1 is computable** — a blueprint is data. The dependency graph, eager set and hook list can be derived without touching the DOM or running a factory. |
| 3 | **One mount, one provide** — no `mountSync` / `provideSync` split; laziness is an option, not a function name. |
| 4 | **Deterministic** — equal public token names are equal tokens; registration order decides overrides; in-flight promises coalesce. |
| 5 | **Disconnect is defined** — one microtask re-parent check before disposal; anonymous sessions dispose, keyed sessions suspend and can be resurrected within a TTL. |
| 6 | **DOM writes are the caller's** — the library provides state and lifecycle, not a projection DSL. |
| 7 | **Tokens are strings** — a public token's runtime identity is `namespace:name`, so separate bundles and `<script>` tags interoperate without a shared import. |

Full rationale: [`docs/archive/0.0.2/00-overview.md`](../../docs/archive/0.0.2/00-overview.md).

## API at a glance

```ts
import {
    createContext,
    defineToken,
    inject,
    mount,
    pipe,
    provide,
    read,
    subscribe$,
    update,
} from '@sandlada/document-context'

const countToken = defineToken<{ inc(): void }>('public')('app:count')

// Phase 1 — pure blueprint, no DOM, no I/O
const blueprint = pipe(
    createContext({ count: 0 }),
    provide(countToken, ({ session }) => ({
        inc: () => update((state) => ({ ...state, count: state.count + 1 }))(session),
    })),
)

// Phase 2 — mount boundary
const host = document.querySelector('#app')
if (host === null) throw new Error('missing #app')

const session = mount(blueprint)(host)   // synchronous handle
await session.ready                       // initialization finished

subscribe$((state) => {
    host.textContent = String(state.count)
})(session)
```

| Purpose | API |
| :--- | :--- |
| Seed | `createContext(initial)` |
| Compose | `pipe(blueprint, ...operators)` |
| Public token | `defineToken<T>(visibility?)(name)` |
| Register a dependency | `provide(token, factory, options?)` |
| Hooks | `onMount` / `onDispose` / `onSuspend` / `onResume` / `onAdopt` |
| Mount | `mount(blueprint, options?)(host)` → `Session` |
| Readiness | `session.ready` |
| Resolve a dependency | `inject<T>` / `inject$<T>` / `injectAll<T>` / `injectAll$<T>` |
| Read / write state | `read(selector)(session)` / `update(updater)(session)` |
| Observe state | `subscribe$(listener)(session)` |
| Track the nearest session | `sessionAt(element)` / `session$(element)` |
| Dispose | `dispose(session)` / `await session[Symbol.asyncDispose]()` |
| Composition root | `createApplication(ports)` |

Normative details: [`docs/archive/0.0.2/01-api.md`](../../docs/archive/0.0.2/01-api.md).

## Installation

```bash
npm install @sandlada/document-context rxjs
```

RxJS is a **required peer dependency** (`^7.8.0 || ^8.0.0`).

## Package subpaths

The export map is fixed; there is **no** `./infrastructure/storage` in this generation — persistence is out of scope.

| Import | Use |
| :--- | :--- |
| `@sandlada/document-context` | Default wired API (composition root) |
| `@sandlada/document-context/application` | `createApplication` + verbs with custom ports |
| `@sandlada/document-context/domain` | Ports, models, tokens |
| `@sandlada/document-context/infrastructure/dom` | DOM adapters |
| `@sandlada/document-context/infrastructure/ssr` | SSR helpers |

See [`docs/archive/0.0.2/11-composition.md`](../../docs/archive/0.0.2/11-composition.md) §11.4.

### SSR

```ts
import { createSsrApplication } from '@sandlada/document-context/infrastructure/ssr'

// one application per request
const app = createSsrApplication()
const session = app.mount(blueprint)({ kind: 'server' })
await session.ready
const state = app.read((value) => value)(session)
app.dispose(session)
app.release()
```

The server never runs `onMount` / `onSuspend` / `onResume`, and an injection can only target a `Session` — there are no elements on the server.

## Implementation notes

Behaviour that the design corpus leaves to the implementation phase, decided here and covered by tests:

| Topic | Decision |
| :--- | :--- |
| Single vs. multi registrations | Two separate pools. `multi: true` registrations are collected by `injectAll` only; they never answer a single-value `inject` ([01-api.md](../../docs/archive/0.0.2/01-api.md) §1.4). |
| `detail.callback` argument | The value, or a **Promise** of it when the provider's factory is asynchronous. Consumers use `await` ([10-events.md](../../docs/archive/0.0.2/10-events.md) §10.1.4). |
| Cross-bundle resolution | The scope transport declares whether it is *authoritative*. The DOM transport is not — a token another bundle provides is invisible to the local index, so a miss asks the Context Protocol bus before becoming final ([14-ports.md](../../docs/archive/0.0.2/14-ports.md) §14.4). |
| Provider index | Lives on the **document**, not on the module, so two applications in one document see each other's providers and it disappears with the document. |
| Initialization order | One microtask yield before the eager factories, so `update` calls made right after `mount` land in the seed state. Every real time behaviour still goes through the scheduler port. |
| Root entry in Node | The default application is created lazily; the DOM adapter reads no DOM global at module evaluation time and throws an explicit `DocumentContextError` when the environment has no document ([16-packaging.md](../../docs/archive/0.0.2/16-packaging.md) §16.3.3). |

## Monorepo layout

| Path | Role |
| :--- | :--- |
| [`packages/document-context`](.) | Canonical package of the next generation (`0.0.2-20261105.a`) |
| [`packages/demo`](../demo) | Vite multi-page demo |
| [`packages/site`](../site) | Starlight docs (legacy `0.0.1` snapshot) |
| [`docs/archive/0.0.2`](../../docs/archive/0.0.2) | The design corpus for the next generation — **source of truth** |
| [`docs/archive/0.0.2/REVIEW.md`](../../docs/archive/0.0.2/REVIEW.md) | Gap review and architecture recommendations for that corpus |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development workflows, project commands, and verification steps.

## License

MIT — see [LICENSE](./LICENSE).
