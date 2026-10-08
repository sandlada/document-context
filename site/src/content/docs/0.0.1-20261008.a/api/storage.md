---
title: "Storage: withStorage hydration"
description: "Persistence for document-context: withStorage adapters, hydration
  strategies and cross-tab sync."
editUrl: false
next: false
prev: false
slug: 0.0.1-20261008.a/api/storage
---

## Functions

### createLocalStorageAdapter()

Creates a synchronous [IStorageAdapter](/0.0.1-20261008.a/api/core/#istorageadapter) over `localStorage`.

The underlying `Storage` is resolved lazily per call via
`getStorageInstance('localStorage')`, so the adapter tracks the
environment (native storage when available, in-memory fallback otherwise).
Values are stringified on write.

```ts
export function createLocalStorageAdapter(): IStorageAdapter;
```

Defined in: [src/storage/adapters.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/storage/adapters.ts)

#### Example

```ts
import { createLocalStorageAdapter } from '@sandlada/document-context'

const adapter = createLocalStorageAdapter()
adapter.setItem('k', JSON.stringify({ count: 1 }))
```

***

### createSessionStorageAdapter()

Creates a synchronous [IStorageAdapter](/0.0.1-20261008.a/api/core/#istorageadapter) over `sessionStorage`.

Same lazy-resolution and stringification contract as
`createLocalStorageAdapter()`, scoped to the tab lifetime instead of
origin persistence.

```ts
export function createSessionStorageAdapter(): IStorageAdapter;
```

Defined in: [src/storage/adapters.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/storage/adapters.ts)

#### Example

```ts
import { createSessionStorageAdapter } from '@sandlada/document-context'

const adapter = createSessionStorageAdapter()
adapter.setItem('k', 'v')
```

***

### deserializeWithMigration()

Deserializes a versioned payload, migrating stale schemas when asked.

`null` / `undefined` input yields `null` (no data). Enveloped payloads
(`{__v, data}`) return `data` directly when `__v >= targetVersion`, or
`migrate(data, __v)` when older and a `migrate` function is supplied (no
migrate function means the stale data is returned as-is). Legacy bare JSON
without an envelope returns parsed as-is. Malformed JSON throws and is
converted upstream to `InvalidStorageDataError`.

```ts
export function deserializeWithMigration(
    raw: string | null,
    targetVersion = 1,
    migrate?: (oldData: any, oldVersion: number) => any
): any;
```

Defined in: [src/storage/adapters.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/storage/adapters.ts)

#### Throws

When `raw` is not valid JSON.

#### Example

```ts
import { deserializeWithMigration } from '@sandlada/document-context'

const data = deserializeWithMigration(raw, 2, (old, v) => ({ count: Number(old.count) || 0 }))
```

***

### extractDomProperties()

Extracts live DOM values for every bridge binding into a partial state.

Iterates all `blueprint.bridges` in order, reads each bound path via
`readDomProperty()`, applies the rule-level `parse` codec when present, and
keeps the value unless it is `null`, `undefined`, or `''` (empty attributes
count as absent). Later bridges overwrite earlier ones on key collision.

```ts
export function extractDomProperties<S extends Record<PropertyKey, any>>(
    blueprint: IContextBlueprint<S, any>,
    element: HTMLElement
): Partial<S>;
```

Defined in: [src/storage/hydration.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/storage/hydration.ts)

#### Example

```ts
import { extractDomProperties } from '@sandlada/document-context'

const domState = extractDomProperties(blueprint, element)
```

***

### getStorageAdapter()

Normalizes a `withStorage` adapter option to a concrete adapter object.

The `'localStorage'` / `'sessionStorage'` shorthands construct the matching
built-in adapter; any other value (custom sync or async object) passes
through untouched. No validation is performed here; failures surface later
as `InvalidStorageDataError` on the session error stream.

```ts
export function getStorageAdapter(
    adapter: 'localStorage' | 'sessionStorage' | IStorageAdapter<any> | IAsyncStorageAdapter<any>
): IStorageAdapter<any> | IAsyncStorageAdapter<any>;
```

Defined in: [src/storage/adapters.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/storage/adapters.ts)

#### Example

```ts
import { getStorageAdapter } from '@sandlada/document-context'

const adapter = getStorageAdapter('localStorage')
```

***

### getStorageInstance()

Resolves a usable `Storage` for `'localStorage'` or `'sessionStorage'`.

Probes `window[type]` first, then `globalThis[type]`, verifying each with a
`__test_probe__` write-remove round trip (guards private-mode throws and
Node 22 without `--localstorage-file`). When every probe fails, returns a
process-local in-memory fallback cached per type, so SSR and happy-dom
tests keep working without persistence.

```ts
export function getStorageInstance(type: 'localStorage' | 'sessionStorage'): Storage;
```

Defined in: [src/storage/adapters.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/storage/adapters.ts)

#### Example

```ts
import { getStorageInstance } from '@sandlada/document-context'

getStorageInstance('localStorage').setItem('k', 'v')
```

***

### resolveHydratedState()

Merges blueprint seeds, live DOM values, and persisted storage into the
initial session state according to a precedence strategy.

Pure function: reads DOM synchronously, allocates a fresh object, and never
touches the session. Non-object `storageData` is treated as `{}`. Spread
order (later wins) per strategy: `'storageFirst'` (default)
`{...blueprint, ...dom, ...storage}`; `'domFirst'` and `'merge'` are
currently identical, both `{...blueprint, ...storage, ...dom}`;
`'blueprintFirst'` is `{...dom, ...storage, ...blueprint}`.

```ts
export function resolveHydratedState<S extends Record<PropertyKey, any>>(
    blueprint: IContextBlueprint<S, any>,
    element: HTMLElement,
    storageData: Partial<S> | null | undefined,
    strategy: HydrationStrategy = 'storageFirst'
): S;
```

Defined in: [src/storage/hydration.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/storage/hydration.ts)

#### Example

```ts
import { resolveHydratedState } from '@sandlada/document-context'

const state = resolveHydratedState(blueprint, element, { count: 5 }, 'storageFirst')
```

***

### serializeWithVersion()

Serializes state into the versioned `{"__v", "data"}` envelope.

Every persistence write goes through this function, so readers can detect
stale schemas via `__v` and migrate. `data` is embedded as-is (no schema
filtering); `version` defaults to `1`.

```ts
export function serializeWithVersion(data: any, version = 1): string;
```

Defined in: [src/storage/adapters.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/storage/adapters.ts)

#### Example

```ts
import { serializeWithVersion } from '@sandlada/document-context'

localStorage.setItem('counter', serializeWithVersion({ count: 1 }, 2))
```

***

### setupStorage()

Activates persistence, hydration, and cross-tab sync for a mounted session.

Normally invoked by the `withStorage` mount hook (and redundantly by the
storage global mount plugin when `blueprint.storage` exists), not by hand.
The pipeline is: synchronous read + `resolveHydratedState()` seeding (async
adapters hydrate late via `update()` instead) → `BroadcastChannel`
`sandlada-sync-{key}` subscription (unless `crossTabSync === false`) →
state subscription persisting every emission through
`serializeWithVersion()` (coordinated by `navigator.locks` when available,
rebroadcasting to the channel) → window `storage`-event listener. Every
parse or write failure is routed to the session error stream as
`InvalidStorageDataError`; disposed sessions stop persisting and applying
remote updates.

```ts
export function setupStorage<S extends Record<PropertyKey, any>>(
    session: ISession<S, any>,
    storageOptions: IStorageOptions<S>
): () => void;
```

Defined in: [src/storage/sync.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/storage/sync.ts)

#### Example

```ts
import { setupStorage } from '@sandlada/document-context'

const cleanup = setupStorage(session, { adapter: 'localStorage', key: 'counter' })
cleanup()
```

***

### withStorage()

Pure Phase 1 operator that registers persistence and hydration options.

Stores `options` on `blueprint.storage` (replacing any previous storage
config) and adds a `mount` hook invoking
`setupStorage(session, options)`. The operator itself performs no I/O; all
reads, writes, and channel subscriptions start at mount.

```ts
export function withStorage<S extends Record<PropertyKey, any> = Record<PropertyKey, any>, Services = {}>(
    options: IStorageOptions<S>
): <ActualState extends S, ActualServices extends Services>(
    blueprint: IContextBlueprint<ActualState, ActualServices>
) => IContextBlueprint<ActualState, ActualServices>;
```

Defined in: [src/storage/with-storage.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/storage/with-storage.ts)

#### Example

```ts
import { withStorage } from '@sandlada/document-context'

const blueprint = pipe(
    createContext({ count: 0 }),
    withStorage({ adapter: 'localStorage', key: 'counter-app', version: 1 })
)
```

## References

### HydrationStrategy

Re-exports [HydrationStrategy](/0.0.1-20261008.a/api/core/#hydrationstrategy)

***

### IAsyncStorageAdapter

Re-exports [IAsyncStorageAdapter](/0.0.1-20261008.a/api/core/#iasyncstorageadapter)

***

### IStorageAdapter

Re-exports [IStorageAdapter](/0.0.1-20261008.a/api/core/#istorageadapter)

***

### IStorageOptions

Re-exports [IStorageOptions](/0.0.1-20261008.a/api/core/#istorageoptions)
