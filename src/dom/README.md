# DOM module (`@sandlada/document-context/dom`)

W3C Context Protocol scope resolution over the physical DOM tree, plus the centralized observer that gives sessions zero-leak garbage collection. See the [W3C protocol](/w3c-protocol/) guide.

## Injection verbs (data-last, curried)

| Export | Purpose |
| --- | --- |
| `inject(token)(target)` | Sync resolution from an `ISession` or any descendant `HTMLElement`. |
| `injectAsync(token, options?)(target)` | Async resolution with Promise coalescing and abort isolation. |
| `injectAll(token, options?)(target)` | Collects every matching provider up the ancestor chain (`bottomUp` \| `topDown`). |
| `injectAllAsync(token, options?)(target)` | Async variant resolved via `Promise.all()`. |

```ts
import { inject, injectAsync } from '@sandlada/document-context/dom'

const logger = inject('logger')(document.getElementById('login-btn')!)
const user = await injectAsync('user')(document.getElementById('profile')!)
```

## Protocol events

`ContextRequestEvent` carries `{ context, callback, subscribe, multi }` with `bubbles: true, composed: true, cancelable: true`, so requests penetrate open and closed Shadow DOM without reading `event.target`. Providers answer via `callback(instance, unsubscribe)` and call `stopPropagation()` unless `multi: true`. Streaming subscriptions (`subscribe: true`) re-invoke the callback on every state change until unsubscribed.

Calling `inject` on a node with `isConnected === false` falls back to the global singleton registry, otherwise throws `UnconnectedNodeError` with a fix guide.

## Observer and GC

The centralized root `MutationObserver` tracks sessions with `WeakMap`/`WeakRef` (zero strong `HTMLElement` retention), confirms disconnects in a microtask to survive reparenting moves, migrates sessions across documents on `adoptNode`, and parks keyed sessions (`data-context-key`) in a 50ms suspended state before disposal.
