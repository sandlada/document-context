# Bridge module (`@sandlada/document-context/bridge`)

Bidirectional synchronization between reactive state and physical DOM properties, with loop guards and security sanitization. Composed in Phase 1 via `withBridge`, executed after `mount`.

## Operator

| Export | Purpose |
| --- | --- |
| `withBridge(options)` | Registers `properties` dot-path rules, `events`, and `batch` behavior. |

```ts
import { createContext, pipe, mount } from '@sandlada/document-context/core'
import { withBridge } from '@sandlada/document-context/bridge'

const blueprint = pipe(
    createContext({ count: 0, theme: 'light' as 'light' | 'dark' }),
    withBridge({ properties: { count: 'dataset.count', theme: 'dataset.theme' } })
)
const session = mount(blueprint)(document.getElementById('counter-box')!)
```

## Supported targets

`dataset.*`, `style.*` (including CSS variables `--*`), `aria-*`, form properties (`value`, `checked`, `disabled`, `readOnly`), standard HTML properties (`id`, `lang`, `title`, `hidden`), and Form-Associated Custom Elements (`elementInternals`).

Boolean attributes follow HTML semantics: `true` sets the property and `setAttribute(name, '')`, `false` clears the property and calls `removeAttribute`. Custom presence toggles use `transform: (v) => (v ? '' : null)` with `parse: (v) => v !== null`.

## Safety internals

| Export | Purpose |
| --- | --- |
| `sanitize` guards | Block prototype pollution (`__proto__`, `prototype`, `constructor`) and DOM XSS sinks (`innerHTML`, `outerHTML`, `srcdoc`, `script`). |
| `loop-guard` | `InternalWriteSymbol` transaction lock, `Object.is` snapshot diffing, microtask batch coalescing, and active-element focus/cursor preservation for inputs. |
