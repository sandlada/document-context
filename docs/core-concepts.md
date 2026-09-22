# Core Concepts

Two ideas carry the whole library: a pure blueprint phase with zero side effects, and a mount boundary that activates the blueprint on a physical DOM node. All verbs are curried data-last functions: configuration first, target last.

## Phase 1: pure blueprint

`createContext` and the `with*` operators only build immutable data. No DOM access, no I/O, no listeners. Call them in any order inside `pipe` and you always get a new blueprint.

```ts
import { createContext, pipe, withProvider, withBridge, withStorage } from '@sandlada/document-context'

const blueprint = pipe(
    createContext({ count: 0 }),
    withProvider('logger', () => new ConsoleLogger(), { lifecycle: 'singleton' }),
    withBridge({ properties: { count: 'dataset.count' } }),
    withStorage({ adapter: 'localStorage', key: 'counter-app' })
)
```

## Phase 2: mount boundary

`mount(blueprint)(element)` is the only place where side effects happen: state store creation, event listeners, bridge wiring, and observer registration. The returned session is cached per element in a `WeakMap`, so mounting twice is idempotent.

```ts
import { mount, select, update, subscribe } from '@sandlada/document-context'

const session = mount(blueprint)(document.getElementById('counter-box')!)
const getCount = select((s: { count: number }) => s.count)
const increment = update<{ count: number }>((s) => ({ count: s.count + 1 }))
increment(session)
const unsubscribe = subscribe((state) => console.log(state.count))(session)
unsubscribe()
```

## Data-last verbs

Every verb follows `verb(config)(target)`: `select(selector)(session)`, `update(updater)(session)`, `inject(token)(elementOrSession)`. The shape stays identical whether the target is a session or a descendant element. String tokens are first-class through `ServiceRegistry` declaration merging.

## Where to go next

- [Module specs](/specs/core/) for every operator signature.
- [Lifecycles](/lifecycles/) for what happens after mount.
- [W3C protocol](/w3c-protocol/) for cross-bundle dependency resolution.
