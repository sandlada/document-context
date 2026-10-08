---
title: "DOM: inject, context-request"
description: "W3C Context Protocol bindings: inject, injectAsync, injectAll plus
  observer-based zero-leak GC."
editUrl: false
next: false
prev: false
slug: 0.0.1-20261008.a/api/dom
---

## Classes

### ContextRequestEvent

Defined in: [src/dom/events.ts:64](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/events.ts#L64)

Standard W3C Community Context Protocol request event.

Dispatched synchronously from the injection target so ancestors can answer
in the same task. Construct with `(context, callback, { subscribe, multi
}?)`; both flags default to `false`.

#### Param

**context**

Token being requested.

#### Param

**callback**

Response callback receiving the resolved value.

#### Param

**options**

Optional `{ subscribe, multi }` flags.

#### Example

```ts
import { ContextRequestEvent } from '@sandlada/document-context'

const event = new ContextRequestEvent('logger', (value, dispose) => {
    console.log('got logger', value)
})
element.dispatchEvent(event)
```

#### Extends

* `CustomEvent`\<[`ContextRequestDetail`](/0.0.1-20261008.a/api/dom/#contextrequestdetail)\<`ContextType`, `ValueType`>>

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `ContextType` | `any` |
| `ValueType` | `any` |

#### Constructors

##### Constructor

> **new ContextRequestEvent**\<`ContextType`, `ValueType`>(`context`, `callback`, `options?`): [`ContextRequestEvent`](/0.0.1-20261008.a/api/dom/#contextrequestevent)\<`ContextType`, `ValueType`>

Defined in: [src/dom/events.ts:68](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/events.ts#L68)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `context` | `ContextType` |
| `callback` | [`ContextCallback`](/0.0.1-20261008.a/api/dom/#contextcallback)\<`ValueType`> |
| `options?` | \{ `multi?`: `boolean`; `subscribe?`: `boolean`; } |
| `options.multi?` | `boolean` |
| `options.subscribe?` | `boolean` |

###### Returns

[`ContextRequestEvent`](/0.0.1-20261008.a/api/dom/#contextrequestevent)\<`ContextType`, `ValueType`>

###### Overrides

`CustomEvent<ContextRequestDetail<ContextType, ValueType>>.constructor`

#### Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-at_target" /> `AT_TARGET` | `readonly` | `2` | - | `CustomEvent.AT_TARGET` |
| <a id="property-bubbles" /> `bubbles` | `readonly` | `boolean` | The **`bubbles`** read-only property of the Event interface indicates whether the event bubbles up through the DOM tree or not. [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/bubbles) | `CustomEvent.bubbles` |
| <a id="property-bubbling_phase" /> `BUBBLING_PHASE` | `readonly` | `3` | - | `CustomEvent.BUBBLING_PHASE` |
| <a id="property-cancelable" /> `cancelable` | `readonly` | `boolean` | The **`cancelable`** read-only property of the Event interface indicates whether the event can be canceled, and therefore prevented as if the event never happened. [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/cancelable) | `CustomEvent.cancelable` |
| <a id="property-cancelbubble" /> ~~`cancelBubble`~~ | `public` | `boolean` | The **`cancelBubble`** property of the Event interface is deprecated. Use Event.stopPropagation() instead. Setting its value to true before returning from an event handler prevents propagation of the event. In later implementations, setting this to false does nothing. See Browser compatibility for details. :::caution\[Deprecated] [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/cancelBubble) ::: | `CustomEvent.cancelBubble` |
| <a id="property-capturing_phase" /> `CAPTURING_PHASE` | `readonly` | `1` | - | `CustomEvent.CAPTURING_PHASE` |
| <a id="property-composed" /> `composed` | `readonly` | `boolean` | The read-only **`composed`** property of the Event interface returns a boolean value which indicates whether or not the event will propagate across the shadow DOM boundary into the standard DOM. [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/composed) | `CustomEvent.composed` |
| <a id="property-currenttarget" /> `currentTarget` | `readonly` | `EventTarget` | `null` | The **`currentTarget`** read-only property of the Event interface identifies the element to which the event handler has been attached. [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/currentTarget) | `CustomEvent.currentTarget` |
| <a id="property-defaultprevented" /> `defaultPrevented` | `readonly` | `boolean` | The **`defaultPrevented`** read-only property of the Event interface returns a boolean value indicating whether or not the call to Event.preventDefault() canceled the event. [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/defaultPrevented) | `CustomEvent.defaultPrevented` |
| <a id="property-detail" /> `detail` | `readonly` | [`ContextRequestDetail`](/0.0.1-20261008.a/api/dom/#contextrequestdetail) | The read-only **`detail`** property of the CustomEvent interface returns any data passed when initializing the event. [MDN Reference](https://developer.mozilla.org/docs/Web/API/CustomEvent/detail) | `CustomEvent.detail` |
| <a id="property-eventphase" /> `eventPhase` | `readonly` | `number` | The **`eventPhase`** read-only property of the Event interface indicates which phase of the event flow is currently being evaluated. [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/eventPhase) | `CustomEvent.eventPhase` |
| <a id="property-istrusted" /> `isTrusted` | `readonly` | `boolean` | The **`isTrusted`** read-only property of the Event interface is a boolean value that is true when the event was generated by the user agent (including via user actions and programmatic methods such as HTMLElement.focus()), and false when the event was dispatched via EventTarget.dispatchEvent(). The only exception is the click event, which initializes the isTrusted property to false in user agents. [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/isTrusted) | `CustomEvent.isTrusted` |
| <a id="property-none" /> `NONE` | `readonly` | `0` | - | `CustomEvent.NONE` |
| <a id="property-returnvalue" /> ~~`returnValue`~~ | `public` | `boolean` | The Event property **`returnValue`** indicates whether the default action for this event has been prevented or not. :::caution\[Deprecated] [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/returnValue) ::: | `CustomEvent.returnValue` |
| <a id="property-srcelement" /> ~~`srcElement`~~ | `readonly` | `EventTarget` | `null` | The deprecated **`Event.srcElement`** is an alias for the Event.target property. Use Event.target instead. :::caution\[Deprecated] [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/srcElement) ::: | `CustomEvent.srcElement` |
| <a id="property-target" /> `target` | `readonly` | `EventTarget` | `null` | The read-only **`target`** property of the Event interface is a reference to the object onto which the event was dispatched. It is different from Event.currentTarget when the event handler is called during the bubbling or capturing phase of the event. [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/target) | `CustomEvent.target` |
| <a id="property-timestamp" /> `timeStamp` | `readonly` | `number` | The **`timeStamp`** read-only property of the Event interface returns the time (in milliseconds) at which the event was created. [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/timeStamp) | `CustomEvent.timeStamp` |
| <a id="property-type" /> `type` | `readonly` | `string` | The **`type`** read-only property of the Event interface returns a string containing the event's type. It is set when the event is constructed and is the name commonly used to refer to the specific event, such as click, load, or error. [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/type) | `CustomEvent.type` |

#### Methods

##### composedPath()

> **composedPath**(): `EventTarget`\[]

Defined in: site/node\_modules/typescript/lib/lib.dom.d.ts:14245

The **`composedPath()`** method of the Event interface returns the event's path which is an array of the objects on which listeners will be invoked. This does not include nodes in shadow trees if the shadow root was created with its ShadowRoot.mode closed.

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/composedPath)

###### Returns

`EventTarget`\[]

###### Inherited from

`CustomEvent.composedPath`

##### ~~initCustomEvent()~~

> **initCustomEvent**(`type`, `bubbles?`, `cancelable?`, `detail?`): `void`

Defined in: site/node\_modules/typescript/lib/lib.dom.d.ts:11288

The **`CustomEvent.initCustomEvent()`** method initializes a CustomEvent object. If the event has already been dispatched, this method does nothing.

:::caution[Deprecated]
[MDN Reference](https://developer.mozilla.org/docs/Web/API/CustomEvent/initCustomEvent)
:::

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `type` | `string` |
| `bubbles?` | `boolean` |
| `cancelable?` | `boolean` |
| `detail?` | [`ContextRequestDetail`](/0.0.1-20261008.a/api/dom/#contextrequestdetail)\<`ContextType`, `ValueType`> |

###### Returns

`void`

###### Inherited from

`CustomEvent.initCustomEvent`

##### ~~initEvent()~~

> **initEvent**(`type`, `bubbles?`, `cancelable?`): `void`

Defined in: site/node\_modules/typescript/lib/lib.dom.d.ts:14252

The **`Event.initEvent()`** method is used to initialize the value of an event created using Document.createEvent().

:::caution[Deprecated]
[MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/initEvent)
:::

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `type` | `string` |
| `bubbles?` | `boolean` |
| `cancelable?` | `boolean` |

###### Returns

`void`

###### Inherited from

`CustomEvent.initEvent`

##### preventDefault()

> **preventDefault**(): `void`

Defined in: site/node\_modules/typescript/lib/lib.dom.d.ts:14258

The **`preventDefault()`** method of the Event interface tells the user agent that the event is being explicitly handled, so its default action, such as page scrolling, link navigation, or pasting text, should not be taken.

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/preventDefault)

###### Returns

`void`

###### Inherited from

`CustomEvent.preventDefault`

##### stopImmediatePropagation()

> **stopImmediatePropagation**(): `void`

Defined in: site/node\_modules/typescript/lib/lib.dom.d.ts:14264

The **`stopImmediatePropagation()`** method of the Event interface prevents other listeners of the same event from being called.

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/stopImmediatePropagation)

###### Returns

`void`

###### Inherited from

`CustomEvent.stopImmediatePropagation`

##### stopPropagation()

> **stopPropagation**(): `void`

Defined in: site/node\_modules/typescript/lib/lib.dom.d.ts:14270

The **`stopPropagation()`** method of the Event interface prevents further propagation of the current event in the capturing and bubbling phases. It does not, however, prevent any default behaviors from occurring; for instance, clicks on links are still processed. If you want to stop those behaviors, see the preventDefault() method. It also does not prevent propagation to other event-handlers of the current element. If you want to stop those, see stopImmediatePropagation().

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/stopPropagation)

###### Returns

`void`

###### Inherited from

`CustomEvent.stopPropagation`

## Interfaces

### ContextRequestDetail

Defined in: [src/dom/events.ts:35](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/events.ts#L35)

Event `detail` payload for a context request.

#### Type Parameters

| Type Parameter |
| ------ |
| `ContextType` |
| `ValueType` |

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-callback" /> `callback` | `readonly` | [`ContextCallback`](/0.0.1-20261008.a/api/dom/#contextcallback)\<`ValueType`> | Invoked by the answering provider with the value. |
| <a id="property-context" /> `context` | `readonly` | `ContextType` | Requested token (string key or branded token object). |
| <a id="property-multi" /> `multi?` | `readonly` | `boolean` | When `true`, every ancestor answers and the event keeps bubbling (`injectAll`); when `false`, the first answer stops propagation. |
| <a id="property-subscribe" /> `subscribe?` | `readonly` | `boolean` | When `true`, the provider keeps pushing updates (state-slice streaming) until the `dispose` callback runs. |

***

### IInjectAllAsyncOptions

Defined in: [src/dom/inject-all.ts:28](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/inject-all.ts#L28)

Ordering plus cancellation options for [injectAllAsync](/0.0.1-20261008.a/api/dom/#injectallasync).

#### Extends

* [`IInjectAllOptions`](/0.0.1-20261008.a/api/dom/#iinjectalloptions)

#### Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-direction" /> `direction?` | `readonly` | `"bottomUp"` | `"topDown"` | See [IInjectAllOptions](/0.0.1-20261008.a/api/dom/#iinjectalloptions). | [`IInjectAllOptions`](/0.0.1-20261008.a/api/dom/#iinjectalloptions).[`direction`](/0.0.1-20261008.a/api/dom/#iinjectalloptions) |
| <a id="property-signal" /> `signal?` | `readonly` | `AbortSignal` | Currently accepted for API symmetry; collection itself is synchronous event dispatch followed by `Promise.all`, so abort only affects awaiting callers that wire it manually. | - |

***

### IInjectAllOptions

Defined in: [src/dom/inject-all.ts:16](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/inject-all.ts#L16)

Ordering options for [injectAll](/0.0.1-20261008.a/api/dom/#injectall) / [injectAllAsync](/0.0.1-20261008.a/api/dom/#injectallasync).

#### Extended by

* [`IInjectAllAsyncOptions`](/0.0.1-20261008.a/api/dom/#iinjectallasyncoptions)

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-direction-1" /> `direction?` | `readonly` | `"bottomUp"` | `"topDown"` | `'bottomUp'` (default) collects nearest-first as the `context-request` event bubbles; `'topDown'` reverses the array so the farthest ancestor comes first. |

***

### IInjectAsyncOptions

Defined in: [src/dom/inject-async.ts:28](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/inject-async.ts#L28)

Options for [injectAsync](/0.0.1-20261008.a/api/dom/#injectasync) / [injectAllAsync](/0.0.1-20261008.a/api/dom/#injectallasync).

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-signal-1" /> `signal?` | `readonly` | `AbortSignal` | Optional `AbortSignal` for per-caller cancellation. A caller abort rejects only that caller's promise with an `AbortError` `DOMException`; the shared in-flight provider promise is unaffected. |

## Type Aliases

### ContextCallback

> **ContextCallback**\<`ValueType`> = (`value`, `dispose?`) => `void`

Defined in: [src/dom/events.ts:20](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/events.ts#L20)

Response callback carried in `ContextRequestDetail`.

The provider invokes it with the resolved value; the optional second
argument unsubscribes a streaming (`subscribe: true`) feed.

#### Type Parameters

| Type Parameter |
| ------ |
| `ValueType` |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | `ValueType` | Resolved service instance or state slice. |
| `dispose?` | () => `void` | Optional streaming unsubscribe for `subscribe: true` requests. |

#### Returns

`void`

`void`.

## Variables

### CONTEXT\_REQUEST\_EVENT

> `const` **CONTEXT\_REQUEST\_EVENT**: `"context-request"` = `'context-request'`

Defined in: [src/dom/events.ts:7](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/events.ts#L7)

Well-known event name for the W3C Community Context Protocol request
channel. Dispatched by `inject()` / `injectAll()` and answered by
`setupProviderResponder()` hosts. Always `bubbles: true`,
`composed: true`, `cancelable: true` so requests cross shadow boundaries.

## Functions

### adoptSessionToDocument()

Migrates a session to a new host document (iframe, popup, or
Picture-in-Picture window).

Stops the old document's root observer when it differs, migrates the keyed
registry entry to the new document, starts the new observer, runs blueprint
`adopt` hooks as `(session, newDocument)`, and dispatches a bubbling,
composed `context-adopt` CustomEvent with `detail: { newDocument }`. Hook
and dispatch failures are sandboxed. The session target element itself is
not moved; move or adopt the node first, then call this to rewire
observation.

```ts
export function adoptSessionToDocument(
    session: ISession<any, any>,
    newDocument: Document
): void;
```

Defined in: [src/dom/observer.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/observer.ts)

#### Example

```ts
import { adoptSessionToDocument } from '@sandlada/document-context'

const popup = window.open('', '_blank')!
popup.document.body.appendChild(session.target)
adoptSessionToDocument(session, popup.document)
```

***

### clearGlobalSingletons()

Clears every entry in the page-wide singleton registry.

Primarily a test-isolation helper (`afterEach(clearGlobalSingletons)`).
Live sessions keep their scoped caches; only future `'singleton'`
resolutions re-run factories.

```ts
export function clearGlobalSingletons(): void;
```

Defined in: [src/dom/inject.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/inject.ts)

#### Example

```ts
import { clearGlobalSingletons } from '@sandlada/document-context'

afterEach(() => clearGlobalSingletons())
```

***

### getGlobalSingleton()

Reads a `'singleton'` instance from the page-wide global registry without
touching the DOM.

```ts
export function getGlobalSingleton<T = unknown>(token: string | ServiceToken<T>): T | undefined;
```

Defined in: [src/dom/inject.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/inject.ts)

#### Example

```ts
import { getGlobalSingleton } from '@sandlada/document-context'

const logger = getGlobalSingleton('logger')
```

***

### inject()

Curried synchronous dependency injection verb.

Resolves `token` against an `ISession` directly (local providers first,
then delegating to the session host element) or against an `HTMLElement`
by dispatching a synchronous `ContextRequestEvent` that bubbles up the DOM
tree: route-cache fast path → ancestor provider → global singleton →
`UnknownServiceError`. Detached nodes throw `UnconnectedNodeError` unless
the token is already a cached global singleton. Async providers throw
`AsyncServiceNotReadyError` unless already cached; use `injectAsync()`.

```ts
export function inject<K extends keyof ServiceRegistry>(
    token: K
): (target: ISession<any, any> | HTMLElement) => ServiceRegistry[K]
export function inject<T>(
    token: ServiceToken<T>
): (target: ISession<any, any> | HTMLElement) => T
export function inject<T = unknown>(
    token: string
): (target: ISession<any, any> | HTMLElement) => T
```

Defined in: [src/dom/inject.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/inject.ts)

#### Param

**token**

Service identifier (registry key, branded token, or string).

#### Throws

When the target is detached and uncached.

#### Throws

When no provider answers.

#### Throws

When the provider is async and uncached.

#### Throws

When factories form a cycle.

#### Example

```ts
import { inject } from '@sandlada/document-context'

const useLogger = inject('logger')
const logger = useLogger(session)
const nested = useLogger(document.getElementById('child')!)
```

Curried synchronous injection over the `ServiceRegistry` string-token map.

Typed overload: `token` must be a key of the globally augmented
`ServiceRegistry`, and the resolved value is `ServiceRegistry[K]`. Use this
overload for application services declared via `declare module`
augmentation.

##### Example

```ts
declare module '@sandlada/document-context' {
    interface ServiceRegistry { 'auth-service': AuthService }
}
const auth = inject('auth-service')(document.getElementById('login')!)
```

Curried synchronous injection over a branded [ServiceToken](/0.0.1-20261008.a/api/core/#servicetoken).

Typed overload: the resolved value is the token's phantom type `T`,
inferred from `ServiceToken<T>`. Prefer over strings for cross-bundle
services where name collisions are a risk.

##### Example

```ts
const logger = inject(LoggerToken)(session)
```

Curried synchronous injection over an untyped string token.

Fallback overload for ad-hoc or unregistered keys; the caller supplies `T`
explicitly. For typed lookups, augment `ServiceRegistry` or use a branded
`ServiceToken` instead.

##### Example

```ts
const theme = inject<'light' | 'dark'>('theme-mode')(childEl)
```

***

### injectAll()

Curried synchronous multi-provider accumulation verb.

Unlike `inject()` (first match wins via `stopPropagation()`), this
dispatches with `multi: true` so every ancestor responder appends its
instance: the local session registration first, then each bubbling host in
turn. Each provider resolves with its own lifecycle semantics via
`resolveServiceInstance()`. Returns a frozen-order plain array (empty when
nothing provides the token; never throws `UnknownServiceError`).

```ts
export function injectAll<K extends keyof ServiceRegistry>(
    token: K,
    options?: IInjectAllOptions
): (target: ISession<any, any> | HTMLElement) => ReadonlyArray<ServiceRegistry[K]>
export function injectAll<T = unknown>(
    token: string | ServiceToken<T>,
    options?: IInjectAllOptions
): (target: ISession<any, any> | HTMLElement) => ReadonlyArray<T>
```

Defined in: [src/dom/inject-all.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/inject-all.ts)

#### Param

**token**

Service identifier.

#### Param

**options**

Optional `{ direction }`; `'topDown'` reverses the
nearest-first collection order.

#### Example

```ts
import { injectAll } from '@sandlada/document-context'

const useMiddlewares = injectAll('middleware', { direction: 'topDown' })
const chain = useMiddlewares(document.getElementById('leaf')!)
```

Curried sync multi-provider accumulation over the `ServiceRegistry` map.

Typed overload: collects `ReadonlyArray<ServiceRegistry[K]>` from the local
session plus every bubbling ancestor responder.

##### Example

```ts
const loggers = injectAll('logger')(childEl)
```

Curried sync multi-provider accumulation over a string or branded token.

Generic overload for untyped keys and `ServiceToken<T>` values.

##### Example

```ts
const middlewares = injectAll('middleware', { direction: 'topDown' })(session)
```

***

### injectAllAsync()

Curried asynchronous multi-provider accumulation verb.

Same bubbling `multi: true` collection as `injectAll()`, except each
collected value may be a promise (async factories are invoked, not awaited
at collection time) and the result is `Promise.all()`-resolved before
returning. A single rejection rejects the whole array. Ordering follows
`options.direction` (`'bottomUp'` default, `'topDown'` reversed).

```ts
export function injectAllAsync<K extends keyof ServiceRegistry>(
    token: K,
    options?: IInjectAllAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<ReadonlyArray<Awaited<ServiceRegistry[K]>>>
export function injectAllAsync<T = unknown>(
    token: string | ServiceToken<T>,
    options?: IInjectAllAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<ReadonlyArray<T>>
```

Defined in: [src/dom/inject-all.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/inject-all.ts)

#### Param

**token**

Service identifier.

#### Param

**options**

Optional `{ direction, signal }`.

#### Example

```ts
import { injectAllAsync } from '@sandlada/document-context'

const plugins = await injectAllAsync('plugin')(document.getElementById('leaf')!)
```

Curried async multi-provider accumulation over the `ServiceRegistry` map.

Typed overload: resolves to
`Promise<ReadonlyArray<Awaited<ServiceRegistry[K]>>>`.

##### Example

```ts
const configs = await injectAllAsync('remote-config')(childEl)
```

Curried async multi-provider accumulation over a string or branded token.

Generic overload for untyped keys and `ServiceToken<T>` values.

##### Example

```ts
const svcs = await injectAllAsync('plugin', { direction: 'topDown' })(session)
```

***

### injectAsync()

Curried asynchronous injection verb with promise coalescing, self-healing
eviction, and multi-caller abort isolation.

Accepts an `ISession` (local providers first) or a connected `HTMLElement`
(nearest mounted ancestor via `parentElement` walk, then global singletons).
Cached values (`'singleton'` globals, `'scoped'` session entries) return
immediately. Otherwise the factory runs once per token: concurrent callers
share the same in-flight promise, rejections evict the entry instantly so
the next call retries, and an already-aborted caller `signal` rejects with
`AbortError` without cancelling the shared attempt. Unknown tokens throw
`UnknownServiceError`; async cycles throw `CircularDependencyError`;
detached nodes throw `UnconnectedNodeError` unless globally cached.

```ts
export function injectAsync<K extends keyof ServiceRegistry>(
    token: K,
    options?: IInjectAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<Awaited<ServiceRegistry[K]>>
export function injectAsync<T>(
    token: ServiceToken<T>,
    options?: IInjectAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<T>
export function injectAsync<T = unknown>(
    token: string,
    options?: IInjectAsyncOptions
): (target: ISession<any, any> | HTMLElement) => Promise<T>
```

Defined in: [src/dom/inject-async.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/inject-async.ts)

#### Param

**token**

Service identifier (registry key, branded token, or string).

#### Param

**options**

Optional `{ signal }` abort options.

#### Throws

When no provider or global entry exists.

#### Throws

When the element target is detached.

#### Throws

When async factories form a cycle.

#### Example

```ts
import { injectAsync } from '@sandlada/document-context'

const useConfig = injectAsync('remote-config')
const config = await useConfig(session)
const [a, b] = await Promise.all([useConfig(el), useConfig(el)])
```

Curried async injection over the `ServiceRegistry` string-token map.

Typed overload: `token` must be a key of the augmented `ServiceRegistry`
and the promise resolves to `Awaited<ServiceRegistry[K]>`.

##### Example

```ts
const config = await injectAsync('remote-config')(document.getElementById('app')!)
```

Curried async injection over a branded [ServiceToken](/0.0.1-20261008.a/api/core/#servicetoken).

Typed overload: resolves to the token's phantom type `T`, unwrapping
provider-level `Promise` nesting via `await` semantics.

##### Example

```ts
const svc = await injectAsync(ConfigToken)(session)
```

Curried async injection over an untyped string token.

Fallback overload; the caller supplies `T` explicitly.

##### Example

```ts
const ctl = new AbortController()
const svc = await injectAsync('remote-config', { signal: ctl.signal })(session)
```

***

### resolveServiceInstance()

Instantiates (or returns the cached) service for one registration record.

Internal resolution primitive used by `inject`, `injectAll`, and the
`context-request` responder. Applies the lifecycle policy: `'singleton'`
consults and populates the global registry, `'scoped'` consults and
populates the session internals, `'transient'` always invokes the factory.
Guards re-entrant factories with the shared `resolutionStack` and throws
`CircularDependencyError` on cycles. Async registrations never resolve here:
a cached async value is returned when present, otherwise
`AsyncServiceNotReadyError` is thrown and callers must use `injectAsync()`.

```ts
export function resolveServiceInstance<T = unknown>(
    registration: IServiceRegistration<T>,
    session: ISession<any, any>
): T;
```

Defined in: [src/dom/inject.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/inject.ts)

#### Throws

When the registration is async and
uncached.

#### Throws

When the factory re-enters its own token.

#### Example

```ts
import { resolveServiceInstance } from '@sandlada/document-context'

const reg = session.blueprint.providers.get('logger')!
const logger = resolveServiceInstance(reg, session)
```

***

### setGlobalSingleton()

Seeds or overwrites a `'singleton'` instance in the page-wide global registry.

Singletons created via factories are cached here automatically; call this
directly to pre-seed test doubles, framework singletons, or values that
must resolve even on detached nodes.

```ts
export function setGlobalSingleton<T = unknown>(
    token: string | ServiceToken<T>,
    instance: T
): void;
```

Defined in: [src/dom/inject.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/inject.ts)

#### Example

```ts
import { setGlobalSingleton } from '@sandlada/document-context'

setGlobalSingleton('logger', new ConsoleLogger())
```

***

### setupProviderResponder()

Attaches the W3C `context-request` responder to a mounted host element.

Internal mount-plugin helper (auto-registered via `registerMountPlugin`):
listens for bubbling `ContextRequestEvent`s from descendants, resolves the
requested token against this session, and invokes `event.detail.callback`.
Sync providers resolve via `resolveServiceInstance()`; async providers
answer from cache or invoke the factory without awaiting (streaming state
keys additionally subscribe to the session subject). Non-`multi` answers
call `stopPropagation()` so the nearest provider wins; `multi` answers let
the event keep bubbling for `injectAll()` accumulation.

***

```ts
export function setupProviderResponder(
    element: HTMLElement,
    session: ISession<any, any>
): () => void;
```

Defined in: [src/dom/inject.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/inject.ts)

### startRootObserver()

Starts (or reuses) the centralized document-level `MutationObserver` that
drives automatic session GC.

One observer per `Document`, observing `body ?? documentElement` with
`{ childList: true, subtree: true }`. Removal batches are funneled into
`processDisconnections()`, which runs inside `queueMicrotask` so a
disconnect followed by a same-task reparent is treated as a move, not a
destroy. Addition batches are funneled into `processAdditions()`, which
resumes a suspended keyed session when its own host node is re-inserted.
Safe to call repeatedly; returns the cached observer.

```ts
export function startRootObserver(doc: Document = document): MutationObserver;
```

Defined in: [src/dom/observer.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/observer.ts)

#### Example

```ts
import { startRootObserver, stopRootObserver } from '@sandlada/document-context'

const observer = startRootObserver(document)
stopRootObserver(document)
```

***

### stopRootObserver()

Disconnects and drops the centralized observer for a document.

Tracked sessions are not disposed by this call; it only stops future
removal detection (used when a session migrates documents via
`adoptSessionToDocument`). Unknown documents are a safe no-op.

```ts
export function stopRootObserver(doc: Document = document): void;
```

Defined in: [src/dom/observer.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/observer.ts)

#### Example

```ts
import { stopRootObserver } from '@sandlada/document-context'

stopRootObserver(document)
```

***

### trackElementForGC()

Registers a host element and its session with the centralized GC tracker.

Auto-invoked by the DOM mount plugin on every `mount()`, and again for the
replacement host on resuscitation (host activation rebind); also ensures
the owner document's root observer is running and registers a
`FinalizationRegistry` fallback that disposes the session if the element is
garbage-collected without a removal record. Entries hold both sides by
`WeakRef`, so tracking itself never leaks.

GC policy on disconnect: hosts without a resolved key dispose
deterministically on the next microtask; keyed hosts enter the suspended
state (suspend hooks + `context-suspend` event with
`detail: { sessionKey, ttl }`, where `ttl` is the resolved
`suspensionTtlMs`) and dispose only if still disconnected when the TTL
elapses. `suspensionTtlMs: 0` disposes immediately without suspending.

```ts
export function trackElementForGC(
    element: HTMLElement,
    session: ISession<any, any>
): void;
```

Defined in: [src/dom/observer.ts](https://github.com/sandlada/document-context/blob/2344664101753082d450755b6d5f66d5fcee9569/src/dom/observer.ts)

#### Example

```ts
import { trackElementForGC } from '@sandlada/document-context'

trackElementForGC(element, session)
```

## References

### IContextBlueprint

Re-exports [IContextBlueprint](/0.0.1-20261008.a/api/core/#icontextblueprint)

***

### ILifecycleHookRegistration

Re-exports [ILifecycleHookRegistration](/0.0.1-20261008.a/api/core/#ilifecyclehookregistration)

***

### ILifecycleHooks

Re-exports [ILifecycleHooks](/0.0.1-20261008.a/api/core/#ilifecyclehooks)

***

### ISession

Re-exports [ISession](/0.0.1-20261008.a/api/core/#isession)

***

### ServiceRegistry

Re-exports [ServiceRegistry](/0.0.1-20261008.a/api/core/#serviceregistry)

***

### ServiceToken

Re-exports [ServiceToken](/0.0.1-20261008.a/api/core/#servicetoken)
