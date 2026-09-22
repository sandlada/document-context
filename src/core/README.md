# Core module (`@sandlada/document-context/core`)

Pure blueprint operators (Phase 1) and session verbs (Phase 2) for the DOM-anchored IoC container. See the [core concepts](/core-concepts/) guide and the [lifecycles](/lifecycles/) guide for the execution model.

## Blueprint operators (pure, zero DOM)

| Export | Purpose |
| --- | --- |
| `createContext(initialState)` | Creates the immutable blueprint seed. |
| `pipe(source, ...operators)` | Composes operators with progressive service-type inference. |
| `withProvider(token, factory, options?)` | Registers a sync service (`singleton` \| `scoped` \| `transient`). |
| `withAsyncProvider(token, asyncFactory, options?)` | Registers a lazy async service with Promise coalescing. |
| `withHook(event, handler)` | Attaches `mount` \| `dispose` \| `suspend` \| `resuscitate` \| `adopt` hooks. |

```ts
import { createContext, pipe, withProvider, withHook } from '@sandlada/document-context/core'

const blueprint = pipe(
    createContext({ count: 0 }),
    withProvider('logger', () => new ConsoleLogger(), { lifecycle: 'singleton' }),
    withHook('mount', (session) => {
        console.log('Mounted on', session.target)
        return () => console.log('Cleanup on dispose')
    })
)
```

## Session verbs (data-last, curried)

| Export | Purpose |
| --- | --- |
| `mount(blueprint)(element)` | Execution boundary, returns the `ISession`. |
| `mountAsync(blueprint)(element)` | Async mount awaiting storage hydration. |
| `select(selector)(session)` | Synchronous state snapshot reader. |
| `update(updater)(session)` | State transition, returns `false` as a safe no-op when disposed. |
| `subscribe(listener)(session)` | Reactive subscription, returns an unsubscribe function. |
| `dispose(session)` | LIFO teardown, store poisoning, `abortSignal` abort. |
| `readErrorStream(session)` | Non-fatal `Observable<DocumentContextError>`. |

```ts
import { mount, select, update, subscribe } from '@sandlada/document-context/core'

const session = mount(blueprint)(document.getElementById('app-root')!)
const getCount = select((s: { count: number }) => s.count)
const increment = update<{ count: number }>((s) => ({ count: s.count + 1 }))
increment(session)
const unsubscribe = subscribe((state) => console.log(state))(session)
unsubscribe()
```

## Types and errors

`ISession`, `IContextBlueprint`, `ServiceToken`, `ServiceRegistry`, `IBridgeOptions`, `IStorageOptions` and the full error taxonomy (`UnknownServiceError`, `UnconnectedNodeError`, `DisposedSessionError`, `CircularDependencyError`, …) live here. String tokens are first-class via `ServiceRegistry` declaration merging.
