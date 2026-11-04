---
title: "Bridge: withBridge property sync"
description: "DOM bidirectional bridge: withBridge dot-path rules for dataset,
  style, aria and form values."
editUrl: false
next: false
prev: false
slug: 0.0.1-20261008.a/api/bridge
---

## Variables

### InternalWriteSymbol

> `const` **InternalWriteSymbol**: *typeof* [`InternalWriteSymbol`](/0.0.1-20261008.a/api/bridge/#internalwritesymbol)

Defined in: [src/bridge/loop-guard.ts:7](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/bridge/loop-guard.ts#L7)

Symbol-keyed re-entrancy flag marking an element inside a state-to-DOM
transaction. Set by `writeWithTransaction()` and observed by
`isInternalWrite()`; stored on the element itself so concurrent bridges on
different elements never interfere.

## Functions

### isInternalWrite()

Reports whether an element is currently inside a `writeWithTransaction()`
lock.

The bridge DOM-to-state listener consults this first and bails out when
`true`, so programmatic state-to-DOM writes never echo back into `update()`.

```ts
export function isInternalWrite(element: HTMLElement): boolean;
```

Defined in: [src/bridge/loop-guard.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/bridge/loop-guard.ts)

#### Example

```ts
import { isInternalWrite } from '@sandlada/document-context'

el.addEventListener('input', () => {
    if (isInternalWrite(el)) {
        return
    }
})
```

***

### parseBoolean()

Parses DOM-sourced values to boolean with bridge type fidelity.

Returns `true` only for `true`, `'true'`, and `'1'`; everything else
(including `'false'`, `''`, `null`, and `undefined`) is `false`. Use as the
`parse` codec for `aria-*` / `dataset.*` boolean bindings.

```ts
export function parseBoolean(value: unknown): boolean;
```

Defined in: [src/bridge/sanitize.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/bridge/sanitize.ts)

#### Example

```ts
import { parseBoolean } from '@sandlada/document-context'

withBridge({ properties: { open: { target: 'aria-expanded', parse: parseBoolean } } })
```

***

### parseJSON()

Parses JSON-serialized DOM values with a safe fallback.

Non-strings pass through untouched; strings are `JSON.parse()`-ed, and
parse failures return the original string instead of throwing. Ideal for
`dataset.*` bindings carrying objects or arrays.

```ts
export function parseJSON(value: unknown): unknown;
```

Defined in: [src/bridge/sanitize.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/bridge/sanitize.ts)

#### Example

```ts
import { parseJSON } from '@sandlada/document-context'

withBridge({ properties: { filters: { target: 'dataset.filters', parse: parseJSON } } })
```

***

### parseNumber()

Parses DOM-sourced values to number via `Number(value)`.

Empty strings coerce to `0` and non-numeric input to `NaN`; apply a fallback
(`Number(x) || 0`) in the binding when that matters. Use as the `parse`
codec for `dataset.*` numeric bindings.

```ts
export function parseNumber(value: unknown): number;
```

Defined in: [src/bridge/sanitize.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/bridge/sanitize.ts)

#### Example

```ts
import { parseNumber } from '@sandlada/document-context'

withBridge({ properties: { count: { target: 'dataset.count', parse: parseNumber } } })
```

***

### readDomProperty()

Reads a value from a host element through a bridge dot-path.

Supported grammars, in precedence order: `dataset.*` (string or
`undefined`), `style.*` including `style.--*` custom properties,
`aria-*` attributes, `elementInternals.value | elementInternals.state`
(falls back to `.value`), `hidden` (attribute-or-property boolean), any
native property present via `in`, and finally a plain attribute fallback.
Every path is validated first; dangerous segments throw
`PropertySyncSecurityError`.

```ts
export function readDomProperty(element: HTMLElement, path: string): any;
```

Defined in: [src/bridge/property-path.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/bridge/property-path.ts)

#### Throws

On prototype-pollution or XSS-sink paths.

#### Example

```ts
import { readDomProperty } from '@sandlada/document-context'

readDomProperty(el, 'dataset.count')
readDomProperty(el, 'style.--accent')
readDomProperty(input, 'value')
```

***

### safeWriteValueWithCursor()

Writes an input/textarea value without moving the user's caret or causing
redundant reflows.

No-ops when `inputElement.value` already `Object.is`-equals `nextValue`.
When the element is the focused `document.activeElement` with a numeric
selection, the caret is captured and restored via `setSelectionRange()`;
input types that reject selection APIs (for example `email`, `number`) are
shielded by try/catch. Background (unfocused) inputs are written plainly.

```ts
export function safeWriteValueWithCursor(
    inputElement: HTMLInputElement | HTMLTextAreaElement,
    nextValue: string
): void;
```

Defined in: [src/bridge/loop-guard.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/bridge/loop-guard.ts)

#### Example

```ts
import { safeWriteValueWithCursor } from '@sandlada/document-context'

safeWriteValueWithCursor(input, String(state.query))
```

***

### setupBridge()

Activates one bidirectional bridge on an already-mounted host element.

Normally invoked through the `withBridge` host activation, not by hand. The
pipeline is: initial state-to-DOM sync inside a `writeWithTransaction` lock →
reactive state-to-DOM subscription (coalesced via `queueMicrotask` unless
`batch === false`, with `value` paths written through
`safeWriteValueWithCursor`) → DOM-to-state listener on each `events` entry
that re-reads every bound path, diffs with `Object.is`, and pushes changes
via `update()`. Internal (transaction-locked) writes are ignored on the way
back, breaking echo loops; disposed sessions stop syncing, and suspended
sessions skip DOM writes until the activation rebinds with a full
re-projection.

```ts
export function setupBridge<S extends Record<PropertyKey, any>>(
    element: HTMLElement,
    session: ISession<S, any>,
    bridgeOptions: IBridgeOptions<S>
): () => void;
```

Defined in: [src/bridge/with-bridge.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/bridge/with-bridge.ts)

#### Example

```ts
import { setupBridge } from '@sandlada/document-context'

const cleanup = setupBridge(element, session, { properties: { count: 'dataset.count' } })
cleanup()
```

***

### validatePropertyPath()

Rejects bridge paths that enable prototype pollution or target XSS sinks.

Splits `path` on `.`, trims, and lowercases each segment: segments
`__proto__`, `prototype`, `constructor` throw with the offending
`blockedSegment`; segments `innerhtml`, `outerhtml`, `insertadjacenthtml`,
`srcdoc`, `script`, `eval` throw with the offending `blockedSink`. Called
by both `readDomProperty()` and `writeDomProperty()`, so bad mappings fail
fast at mount or first sync rather than writing somewhere dangerous.

```ts
export function validatePropertyPath(path: string, targetNode?: HTMLElement): void;
```

Defined in: [src/bridge/sanitize.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/bridge/sanitize.ts)

#### Throws

When any segment is blocked.

#### Example

```ts
import { validatePropertyPath } from '@sandlada/document-context'

validatePropertyPath('dataset.count', el)
```

***

### withBridge()

Pure Phase 1 operator that registers one bidirectional DOM bridge.

Appends `options` to `blueprint.bridges` and adds a `mount` hook that
registers the bridge as a host activation, binding `setupBridge()` to the
session target. Host activations are rebound on resuscitation, so a keyed
session revived onto a new host keeps syncing against that host, while
state-to-DOM writes are paused during suspension. Multiple `withBridge()`
calls accumulate in order; each activates its own subscription and
listeners. The operator itself is side-effect free.

```ts
export function withBridge<S extends Record<PropertyKey, any> = Record<PropertyKey, any>, Services = {}>(
    options: IBridgeOptions<S>
): <ActualState extends S, ActualServices extends Services>(
    blueprint: IContextBlueprint<ActualState, ActualServices>
) => IContextBlueprint<ActualState, ActualServices>;
```

Defined in: [src/bridge/with-bridge.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/bridge/with-bridge.ts)

#### Example

```ts
import { withBridge, parseNumber } from '@sandlada/document-context'

const blueprint = pipe(
    createContext({ count: 0, query: '' }),
    withBridge({
        properties: {
            count: { target: 'dataset.count', parse: parseNumber },
            query: 'value'
        },
        events: ['input']
    })
)
```

***

### writeDomProperty()

Writes a state value onto a host element through a bridge dot-path.

Mirrors `readDomProperty` grammars with DOM-appropriate null handling:
`null` / `undefined` deletes `dataset.*` entries, removes `style.--*` and
`aria-*` / plain attributes, and clears `value` and style properties to
`''`. Booleans for `checked | disabled | readOnly` set both the IDL
property and the content attribute; `hidden` toggles both together.
Native properties win over attributes when the path exists via `in`.
Every path is validated first; dangerous segments throw
`PropertySyncSecurityError` before any write.

```ts
export function writeDomProperty(
    element: HTMLElement,
    path: string,
    value: any
): void;
```

Defined in: [src/bridge/property-path.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/bridge/property-path.ts)

#### Throws

On prototype-pollution or XSS-sink paths.

#### Example

```ts
import { writeDomProperty } from '@sandlada/document-context'

writeDomProperty(el, 'dataset.count', 3)
writeDomProperty(el, 'aria-pressed', true)
writeDomProperty(el, 'dataset.count', null)
```

***

### writeWithTransaction()

Runs a DOM write callback under the internal-transaction lock.

Sets the element flag, invokes `writeFn`, and always clears the flag in a
`finally` block, so bridge-originated writes are recognizable to the
DOM-to-state listener, which skips them and breaks echo loops. Synchronous
only; exceptions from `writeFn` propagate after the flag is cleared.

```ts
export function writeWithTransaction(
    element: HTMLElement,
    writeFn: () => void
): void;
```

Defined in: [src/bridge/loop-guard.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/bridge/loop-guard.ts)

#### Example

```ts
import { writeWithTransaction } from '@sandlada/document-context'

writeWithTransaction(el, () => {
    el.dataset.count = String(state.count)
})
```

## References

### IBridgeOptions

Re-exports [IBridgeOptions](/0.0.1-20261008.a/api/core/#ibridgeoptions)

***

### IBridgePropertyRule

Re-exports [IBridgePropertyRule](/0.0.1-20261008.a/api/core/#ibridgepropertyrule)
