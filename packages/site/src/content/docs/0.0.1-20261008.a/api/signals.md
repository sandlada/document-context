---
title: "Signals: toSignal adapter"
description: "TC39 Signals interop: toSignal adapts a session slice into a
  fine-grained computed signal."
editUrl: false
next: false
prev: false
slug: 0.0.1-20261008.a/api/signals
---

## Interfaces

### ISignal

Defined in: [src/signals/to-signal.ts:13](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/signals/to-signal.ts#L13)

Minimal TC39 Signal-compatible view over a session selector.

Exposes only `get(): T`; the object is not itself reactive. Framework
signal integrations poll or wrap `get()` in their own tracking scope.

#### Type Parameters

| Type Parameter |
| ------ |
| `T` |

#### Methods

##### get()

> **get**(): `T`

Defined in: [src/signals/to-signal.ts:14](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/signals/to-signal.ts#L14)

Returns the latest selector value. See [toSignal](/0.0.1-20261008.a/api/signals/#tosignal).

###### Returns

`T`

## Functions

### toSignal()

Adapts `select(selector)(session)` into a pull-based signal object.

Captures the current selector value immediately, then keeps it fresh via an
internal `subscribe()` feed that re-runs `selector` on every state change.
The subscription is intentionally retained for the session lifetime (no
unsubscribe is returned), so prefer one signal per long-lived view rather
than per render. Selectors must stay pure; disposed sessions freeze the
last value instead of updating.

```ts
export function toSignal<S extends Record<PropertyKey, any>, R>(
    session: ISession<S, any>,
    selector: (state: S) => R
): ISignal<R>;
```

Defined in: [src/signals/to-signal.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/signals/to-signal.ts)

#### Example

```ts
import { toSignal } from '@sandlada/document-context'

const countSignal = toSignal(session, (s: { count: number }) => s.count)
console.log(countSignal.get())
```

## References

### ISession

Re-exports [ISession](/0.0.1-20261008.a/api/core/#isession)
