# DOM Infrastructure Layer

The `infrastructure/dom` layer implements domain ports for physical browser environments and Web Components.

## Invariants

1. **Centralized observation**: uses a single `MutationObserver` instance for the document rather than per-node observers.
2. **Microtask reparenting check**: DOM disconnects undergo a microtask check before triggering suspension or disposal, preventing spurious unmounts during DOM re-arrangements (such as HTMX swaps or framework reconciliations).
3. **W3C Context Protocol**: implements `context-request`, `context-mount`, and `context-dispose` custom DOM events for cross-bundle and shadow-piercing dependency resolution.
4. **Keyed identity**: records session keyed tokens via the `data-context-key` attribute on physical elements.

## Key Exports

- **Host Adapter**: `createDomHostAdapter`, `DomHost`, `DomHostAdapter`, `KEYED_IDENTITY_ATTRIBUTE`.
- **Observer**: `createDomObserver`, `DomObserver`.
- **Scope Transport**: `createDomScopeTransport`, `DomScopeTransport`, `isElement`.
- **W3C Context Protocol Bus**: `CONTEXT_REQUEST_EVENT`, `CONTEXT_MOUNT_EVENT`, `CONTEXT_DISPOSE_EVENT`, `dispatchContextRequest`, `listenContextRequest`, `dispatchContextAnnouncement`.
- **Hierarchy Traversal**: `composedParent`, `composedAncestors`, `domContains`, `isShadowRoot`.
- **Scheduler**: `createBrowserScheduler`.
