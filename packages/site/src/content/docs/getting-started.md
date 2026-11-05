---
title: Getting Started
description: Install @sandlada/document-context and mount your first DOM-anchored session.
---

`@sandlada/document-context` hosts its IoC container and reactive store on physical DOM nodes. You declare
a pure blueprint, mount it on an element, then read and update state through curried verbs.

## Installation

```bash
npm i @sandlada/document-context rxjs
```

:::caution[ESM only]
The package cannot be loaded with `require()`. Your project must use ESM (`import`) or dynamic `import()`.
:::

## Quick start

```ts
import {
    createContext,
    mount,
    pipe,
    read,
    subscribe$,
    update,
} from '@sandlada/document-context'

interface AppState {
    readonly count: number
}

// Phase 1: Pure blueprint (zero DOM, zero side-effects)
const blueprint = pipe(
    createContext<AppState>({ count: 0 }),
)

// Phase 2: Mount boundary (returns session handle synchronously)
const host = document.getElementById('counter-box')!
const session = mount(blueprint)(host)
await session.ready

// Observe state updates via RxJS
subscribe$<AppState>((state) => {
    host.textContent = `Count: ${state.count}`
})(session)

// Update state using pure curried verbs
const increment = update<AppState>((s) => ({ count: s.count + 1 }))
increment(session)

// Synchronous snapshot read
const count = read<AppState, number>((s) => s.count)(session)
console.log('Current count:', count)
```

Detaching the node tears the session down; a keyed session (`mount(blueprint, { token: 'counter-box' })`)
instead suspends for a grace period (`suspensionTtlMs`, default 5000ms) and resuscitates with full state
when the same key is mounted on a replacement node.

## Import paths

The root barrel re-exports wired verbs with a default DOM application. Subpaths let you import from specific layers
to enforce architectural boundaries or configure custom applications.

| Import path | Contents |
| --- | --- |
| `@sandlada/document-context` | Root barrel: Phase 1 blueprint operators and default-application Phase 2 verbs. |
| `@sandlada/document-context/domain` | Pure domain model, port contracts, and errors (zero DOM, zero I/O). |
| `@sandlada/document-context/application` | Composition root (`createApplication`), session verbs, and lifecycle state machines. |
| `@sandlada/document-context/infrastructure/dom` | DOM host adapter, centralized observer, and W3C Context Protocol bus. |
| `@sandlada/document-context/infrastructure/ssr` | Server placeholder host and per-request application (`createSsrApplication`). |
