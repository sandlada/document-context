# @sandlada/document-context

![npm version](https://img.shields.io/npm/v/@sandlada/document-context?label=NPM%20Version&labelColor=%2300531f&color=%23a3f5aa)
![GitHub License](https://img.shields.io/github/license/sandlada/document-context?label=License&labelColor=%2300531f&color=%23a3f5aa)

A modern, function-first Inversion of Control (IoC) container and reactive state management library anchored directly to **`HTMLElement` and physical DOM nodes**.

- **Physical DOM as Scope Hierarchy**: DOM nesting maps directly to IoC container scope hierarchies without virtual container trees.
- **Zero-Leak Lifecycle Co-location**: Automatic garbage collection and subscription cleanup tied to physical DOM attachment.
- **Atomic Bidirectional Bridge**: Synchronize JS reactive state and DOM properties (`dataset.*`, `style.*`, `aria-*`, `value`) with loop guards.
- **Framework-Agnostic Lingua Franca**: Built on native W3C Context Protocol (`ContextRequestEvent`) and Custom Events, seamlessly bridging Astro, Islands, Web Components, and mixed frameworks.
- **Pure FP Two-Phase Architecture**: Pure lazy blueprint declaration in Phase 1 + physical DOM mount execution in Phase 2.

---

## Installation

```bash
npm install @sandlada/document-context
```

---

## Usage (Astro Multi-Component Inline Scripts)

In Astro or Islands architecture, independent `<script is:inline>` blocks bundled across different components can share state and services seamlessly through the physical DOM tree without sharing JavaScript heap memory references.

### 1. Root Context Definition (`Layout.astro`)

Define the pure blueprint and mount it to the root document element with persistent storage and DOM property synchronization:

```html
<script is:inline type="module">
    import { createContext, pipe, withBridge, withStorage, mount } from '@sandlada/document-context'

    const themeBlueprint = pipe(
        createContext({ isDark: false }),
        withBridge({
            properties: {
                isDark: 'dataset.themeDark'
            }
        }),
        withStorage({
            adapter: 'localStorage',
            key: 'app-theme',
            hydrationStrategy: 'storageFirst'
        })
    )

    // Mount to document root element
    window.__themeSession = mount(themeBlueprint)(document.documentElement)
</script>
```

### 2. State Mutator Component (`ThemeToggle.astro`)

An independent toggle button component modifies state using the curried `update` verb:

```html
<script is:inline type="module">
    import { update } from '@sandlada/document-context'

    const btn = document.getElementById('theme-toggle-btn')
    btn?.addEventListener('click', () => {
        const toggle = update((s) => ({ isDark: !s.isDark }))
        toggle(window.__themeSession)
    })
</script>
```

### 3. Reactive Consumer Component (`ThemeDisplay.astro`)

Another independent consumer component subscribes to reactive state changes or reads snapshots via `select` / `subscribe`:

```html
<script is:inline type="module">
    import { select, subscribe } from '@sandlada/document-context'

    const statusEl = document.getElementById('theme-status-text')
    const session = window.__themeSession

    // 1. Initial snapshot read
    const isDark = select((s) => s.isDark)(session)
    if (statusEl) statusEl.textContent = isDark ? '🌙 Dark' : '☀️ Light'

    // 2. Reactive subscription
    subscribe((state) => {
        if (statusEl) {
            statusEl.textContent = state.isDark ? '🌙 Dark' : '☀️ Light'
        }
    })(session)
</script>
```

---

## API Reference

`@sandlada/document-context` provides modular subpath exports for clean tree-shaking:
- `@sandlada/document-context/core`
- `@sandlada/document-context/bridge`
- `@sandlada/document-context/storage`
- `@sandlada/document-context/dom`
- `@sandlada/document-context/signals`

### 1. Core Module (`@sandlada/document-context/core`)

#### `createContext(initialState)`
Creates a pure immutable blueprint seed. Zero DOM access, zero I/O side effects.
```ts
const blueprint = createContext({ count: 0, theme: 'light' })
```

#### `pipe(source, ...operators)`
Functional composition pipeline with progressive TypeScript generic type inference overloads.
```ts
const appBlueprint = pipe(
    createContext({ count: 0 }),
    withProvider('logger', () => new ConsoleLogger()),
    withBridge({ properties: { count: 'dataset.count' } })
)
```

#### `withProvider(token, factory, options?)`
Registers a synchronous service provider on the blueprint.
- `lifecycle`: `'scoped'` (default) | `'singleton'` | `'transient'`
- `multi`: `boolean` (default `false`)
```ts
withProvider('auth', (session) => new AuthService(session), { lifecycle: 'scoped' })
```

#### `withAsyncProvider(token, asyncFactory, options?)`
Registers an asynchronous service provider with lazy execution and Promise coalescing.
```ts
withAsyncProvider('user', async (session) => {
    const res = await fetch('/api/user', { signal: session.abortSignal })
    return res.json()
})
```

#### `withHook(event, handler)`
Attaches declarative lifecycle hooks (`'mount'`, `'dispose'`, `'suspend'`, `'resuscitate'`, `'adopt'`).
```ts
withHook('mount', (session) => {
    console.log('Mounted on', session.target)
    return () => console.log('Cleanup on dispose')
})
```

#### `mount(blueprint)(element)`
Execution boundary that activates the runtime `ISession` on a physical `HTMLElement`.
```ts
const session = mount(appBlueprint)(document.getElementById('app-root')!)
```

#### `mountAsync(blueprint)(element)`
Asynchronous mount boundary awaiting eager storage hydration and async initialization.
```ts
const session = await mountAsync(appBlueprint)(document.getElementById('app-root')!)
```

#### `select(selector)(session)`
Curried synchronous state snapshot reader.
```ts
const getCount = select((s: { count: number }) => s.count)
const currentCount = getCount(session)
```

#### `update(updater)(session)`
Curried state transition verb. Accepts a partial state object or an updater function `(prevState) => nextState`. Returns `boolean` (`false` if session is disposed).
```ts
const increment = update<{ count: number }>((s) => ({ count: s.count + 1 }))
increment(session)
```

#### `subscribe(listener)(session)`
Subscribes to reactive state transitions. Returns an unsubscribe teardown function.
```ts
const unsubscribe = subscribe((state) => {
    console.log('New state:', state)
})(session)
```

#### `dispose(session)`
Explicitly tears down the session, executing LIFO cleanups, poisoning the state store, and aborting `session.abortSignal`.

#### `readErrorStream(session)`
Returns an RxJS `Observable<DocumentContextError>` streaming non-fatal errors (e.g., storage parsing failures, hook exceptions).

---

### 2. Bridge Module (`@sandlada/document-context/bridge`)

#### `withBridge(options)`
Registers bidirectional property synchronization between JavaScript state and DOM element properties.
- `properties`: Record of dot-paths (`dataset.*`, `style.*`, `style.--*`, `aria-*`, `value`, `checked`, `hidden`, `elementInternals.value`).
- `events`: Array of DOM events triggering DOM-to-state sync (default: `['input', 'change']`).
- `batch`: Microtask write batching (default: `true`).

```ts
withBridge({
    properties: {
        count: 'dataset.count',
        theme: 'dataset.theme',
        inputValue: {
            target: 'value',
            parse: Number
        }
    }
})
```

---

### 3. Storage Module (`@sandlada/document-context/storage`)

#### `withStorage(options)`
Configures persistent state storage, schema migrations, and cross-tab synchronization.
- `adapter`: `'localStorage'` | `'sessionStorage'` | custom adapter
- `key`: Storage string key
- `hydrationStrategy`: `'storageFirst'` (default) | `'domFirst'` | `'blueprintFirst'` | `'merge'`
- `crossTabSync`: BroadcastChannel & Window storage sync (default: `true`)
- `version`: Schema version number
- `migrate`: Migration transition function `(oldData, oldVersion) => newData`

```ts
withStorage({
    adapter: 'localStorage',
    key: 'user-settings',
    hydrationStrategy: 'storageFirst',
    version: 2,
    migrate: (oldData: any, oldVersion) => {
        if (oldVersion === 1) return { ...oldData, newField: 'default' }
        return oldData
    }
})
```

---

### 4. DOM & W3C Protocol Module (`@sandlada/document-context/dom`)

#### `inject(token)(target)`
Curried dependency injection verb. Dispatches standard `ContextRequestEvent` bubbling up the physical DOM tree across Shadow DOM boundaries.
```ts
// In a child Web Component or Element
const auth = inject('auth')(this)
```

#### `injectAsync(token, options?)(target)`
Asynchronous dependency injection with Promise Coalescing, DFS circular dependency detection, and multi-caller abort isolation.
```ts
const user = await injectAsync('user', { signal: abortController.signal })(childElement)
```

#### `injectAll(token, options?)(target)` / `injectAllAsync(token, options?)(target)`
Multi-provider accumulation protocol collecting all matching services up the ancestor hierarchy.
- `direction`: `'bottomUp'` (default) | `'topDown'`

```ts
const plugins = injectAll('plugin', { direction: 'topDown' })(childElement)
```

---

### 5. Signals Module (`@sandlada/document-context/signals`)

#### `toSignal(session, selector)`
Adapts a reactive state slice into a TC39 Signal-compatible object with a `.get()` method.

```ts
import { toSignal } from '@sandlada/document-context/signals'

const countSignal = toSignal(session, (s) => s.count)
console.log(countSignal.get())
```

---

### 6. TypeScript `ServiceRegistry` Type Augmentation

String tokens support 100% type safety and auto-completion across bundle boundaries via TypeScript declaration merging:

```ts
// types/context.d.ts
import type { AuthService, Logger } from './services'

declare module '@sandlada/document-context' {
    interface ServiceRegistry {
        'auth:service': AuthService
        'logger:service': Logger
    }
}
```

---

## License

MIT
