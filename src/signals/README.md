# Signals module (`@sandlada/document-context/signals`)

TC39 Signals interop for session state. Adapts a state slice into a fine-grained computed signal without leaking the internal RxJS store.

## Operator

| Export | Purpose |
| --- | --- |
| `toSignal(session, selector)` | Returns a `Signal.Computed` with a `.get()` reader over the selected slice. |

```ts
import { mount, createContext } from '@sandlada/document-context/core'
import { toSignal } from '@sandlada/document-context/signals'

const session = mount(createContext({ count: 0 }))(document.getElementById('counter')!)
const countSignal = toSignal(session, (s) => s.count)
console.log(countSignal.get())
```

The signal stays subscribed for its lifetime; releasing the session and dropping the signal lets both garbage-collect together.
