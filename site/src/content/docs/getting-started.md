---
title: Getting Started
description: Install @sandlada/document-context and mount your first DOM-anchored session.
---

`@sandlada/document-context` hosts its IoC container and reactive store on physical DOM nodes. You declare
a pure blueprint, mount it on an element, then read and update state through curried verbs.

## Installation

```bash
npm i @sandlada/document-context
```

:::caution[ESM only]
The package cannot be loaded with `require()`. Your project must use ESM (`import`) or dynamic `import()`.
:::

## Quick start

```ts
import { createContext, mount, pipe, select, update } from '@sandlada/document-context'
import { withBridge } from '@sandlada/document-context/bridge'

const blueprint = pipe(
    createContext({ count: 0 }),
    withBridge({ properties: { count: 'dataset.count' } })
)

const session = mount(blueprint)(document.getElementById('counter-box')!)

const getCount = select((s: { count: number }) => s.count)
const increment = update<{ count: number }>((s) => ({ count: s.count + 1 }))
increment(session)
console.log(getCount(session))
```

`count` renders to `data-count` on `#counter-box` automatically. Detaching the node tears the session
down; reattaching a keyed node within 50ms resuscitates it instead.

## Import paths

The root barrel re-exports everything. Import from the subpath that matches the capability you need to
keep bundles lean.

| Import path | Contents |
| --- | --- |
| `@sandlada/document-context` | Full barrel: core, bridge, storage, dom, signals. |
| `@sandlada/document-context/core` | `createContext`, `pipe`, `mount`, `select`, `update`, `subscribe`, `dispose`. |
| `@sandlada/document-context/bridge` | `withBridge` bidirectional property sync. |
| `@sandlada/document-context/storage` | `withStorage` persistence and hydration. |
| `@sandlada/document-context/dom` | `inject`, `injectAsync`, `injectAll`, `ContextRequestEvent`. |
| `@sandlada/document-context/signals` | `toSignal` TC39 Signals adapter. |

## Next steps

- [Core concepts](/core-concepts/) — the two-phase model and data-last verbs.
- [Lifecycles](/lifecycles/) — what happens after mount.
- [API Reference](/api/) — every export, generated from the source JSDoc.
