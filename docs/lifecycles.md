# Lifecycles

Four orthogonal lifecycles cooperate on every mount. Each has its own owner and none crosses into another's job.

## 1. Physical DOM lifecycle (W3C standard)

`Unconnected` → `Connected` → `Adopted` → `Disconnected` → GC collected. The library never fights the platform: an unconnected node cannot bubble protocol events, a reparenting move is confirmed in a microtask before anything is torn down, and an `adoptNode` migration re-registers the session on the new document's observer.

## 2. Session state machine

`Blueprint` → `Initializing` → `Mounted` → `Suspended` (keyed, 50ms TTL) → `Resuscitated` → `Disposed`. Keyed sessions (`data-context-key`) pause DOM writes into a dirty queue while suspended and flush it on resuscitation. Disposed sessions poison their store: late `update()` calls safely return `false` instead of throwing.

## 3. Service lifecycle

`singleton` lives in the process-wide registry, `scoped` (default) lives with its session, `transient` is never cached. Factories are lazy by default and run on first `inject`. In-flight async factories coalesce concurrent callers onto one promise and evict it on rejection so the next call retries cleanly.

## 4. State, bridge, and storage lifecycle

Seed → hydration decision (`storageFirst` | `domFirst` | `blueprintFirst` | `merge`) → reactive flow → microtask bridge transaction → finalized. Bridge writes run under a transaction lock with snapshot diffing, so state-to-DOM and DOM-to-state updates never loop. Storage failures emit to `readErrorStream` and fall back to the seed.

## Coordination rule

A DOM disconnect never disposes a session synchronously. The observer waits a microtask, checks `isConnected` again, and only then suspends or disposes. Rendering moves, drag-and-drop, and HTMX swaps stay lossless by default.
