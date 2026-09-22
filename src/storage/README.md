# Storage module (`@sandlada/document-context/storage`)

Persistent state with hydration precedence, schema migration, fault tolerance, and cross-tab synchronization. Composed in Phase 1 via `withStorage`, resolved during `mount`.

## Operator

| Export | Purpose |
| --- | --- |
| `withStorage(options)` | Configures `adapter`, `key`, `hydrationStrategy`, `crossTabSync`, `version`, and `migrate`. |

```ts
import { createContext, pipe, mount } from '@sandlada/document-context/core'
import { withStorage } from '@sandlada/document-context/storage'

const blueprint = pipe(
    createContext({ theme: 'light' as 'light' | 'dark' }),
    withStorage({
        adapter: 'localStorage',
        key: 'app-theme',
        hydrationStrategy: 'storageFirst',
        version: 2,
        migrate: (oldData: unknown, oldVersion: number) => ({ ...(oldData as object) })
    })
)
const session = mount(blueprint)(document.documentElement)
```

## Hydration strategies

| Strategy | Precedence |
| --- | --- |
| `storageFirst` (default) | Persisted state wins, falls back to blueprint seed. |
| `domFirst` | DOM attributes win (currently resolved like `merge`). |
| `blueprintFirst` | Blueprint seed wins. |
| `merge` | Shallow merge of persisted state over the seed. |

## Adapters and sync

Built-in `localStorage` and `sessionStorage` adapters plus custom sync/async adapters. Corrupted payloads emit `InvalidStorageDataError` to `readErrorStream` and fall back to the seed instead of throwing. Cross-tab updates propagate via the `storage` event and `BroadcastChannel`, coordinated with Web Locks.
