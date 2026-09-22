# W3C Context Protocol

Dependency resolution rides the platform event flow instead of a virtual container tree. A consumer dispatches a `context-request` event; the nearest mounted ancestor that owns the token answers through the callback.

## The request

```ts
import { inject } from '@sandlada/document-context/dom'

const auth = inject('auth-service')(document.getElementById('login-btn')!)
```

Underneath, this dispatches a `ContextRequestEvent` with `bubbles: true, composed: true, cancelable: true`. `composed: true` is what lets the request cross Shadow DOM boundaries, including closed roots, because the provider answers via `detail.callback` without reading `event.target`.

## Provider answers

Mounted elements listen for `context-request`, lazily instantiate or reuse their scoped instance, invoke `callback(instance, unsubscribe)`, and call `stopPropagation()` — unless the request sets `multi: true`, in which case every ancestor accumulates via `injectAll`.

```ts
import { injectAll } from '@sandlada/document-context/dom'

const plugins = injectAll('plugin', { direction: 'topDown' })(childElement)
```

## Streaming subscriptions

Passing `subscribe: true` keeps the callback alive: the provider re-invokes it on every state change until the consumer calls `unsubscribe` or the provider session is disposed. Disposal terminates all live streams for that provider.

## Rules that prevent bugs

- Unconnected nodes cannot bubble: `inject` on a detached node falls back to global singletons, otherwise throws `UnconnectedNodeError`.
- Route caching uses `WeakRef` and is invalidated by ancestor-tree mutations, so virtual-list recycling never serves a stale provider.
- Async providers coalesce concurrent `injectAsync` calls and evict rejections for self-healing retries.
