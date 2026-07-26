# Document Context Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the theme-bundled document context with a function-first, type-inferable IoC container hosted on HTML objects, including bidirectional property sync, scoped services, and adapter-based persistence.

**Architecture:** Single-layer functional core (`src/core/*.ts`) where every public operation is a top-level pure function operating on an opaque session token returned by `mount()`. Side effects live under `src/adapters/*` and are registered through string identifiers. The build path remains a single ESM browser bundle via tsdown with strict TS settings and no extra runtime dependencies beyond `rxjs` (devDep).

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), tsdown (single entry ESM + dts), vitest + happy-dom, rxjs 7.x (devDep).

## Global Constraints

- TypeScript: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUncheckedSideEffectImports`, `verbatimModuleSyntax`, `isolatedModules`, ES2022 target, `moduleResolution: bundler`, modules = ESNext.
- Editor config: 4-space indent, LF, single quotes, `max_line_length = 240`, final newline.
- Source root: `src/`; build root: `build/` (gitignored).
- `rxjs` is a `devDependency` only; only type re-exports (`Observable`, `Subscription`) leave the public surface.
- `tsdown.config.ts`: single entry `src/index.ts`, ESM only, browser platform, dts emitted, cleans `outDir` (`./build`) on each build.
- Vitest: `happy-dom` env, `test/setup.ts` preloaded.
- Naming: every new public function is camelCase and verb-led; no classes are allowed in `src/core/`.
- Imports of `rxjs` may only appear in `src/adapters/*` and `src/core/internals/*`; they must never be re-exported by `src/index.ts`.

---

### Task 1: Project Bootstrap & Old Surface Removal

**Files:**
- Delete: `src/domain/` (entire tree)
- Delete: `src/infrastructure/` (entire tree)
- Delete: `src/application/` (entire tree)
- Modify: `src/document-binder.ts` (replace contents)
- Create: `src/core/index.ts` (placeholder, just `export {}`)
- Create: `src/index.ts` (re-export from `./core`)
- Create: `src/errors.ts` (placeholder, exports `CircularDependencyError`)
- Modify: `package.json` (description + keywords)
- Modify: `README.md` (description text)
- Test: `test/setup.ts` (reset every Symbol in addition to current logic)

**Interfaces:**
- Consumes: none yet.
- Produces:
  - `src/core/index.ts` empty module.
  - `src/errors.ts` exports:
    ```ts
    export class LibraryError extends Error { constructor(message: string, public override cause?: unknown) { super(message); this.name = new.target.name; } }
    export class CircularDependencyError extends LibraryError { constructor(public readonly cycle: readonly string[]) { super('Circular dependency: ' + cycle.join(' -> ')); } }
    export class UnknownScopeError extends LibraryError {}
    export class UnknownServiceError extends LibraryError {}
    export class InvalidInitialStateError extends LibraryError {}
    export class InvalidStoredStateError extends LibraryError {}
    export class InvalidPropertyError extends LibraryError {}
    export class PropertySyncError extends LibraryError {}
    ```

- [ ] **Step 1: Write the failing test for the new test setup**

Replace `test/setup.ts` with:

```ts
import { beforeEach, vi } from 'vitest';

const createLocalStorageMock = () => {
    const store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = String(value); },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { Object.keys(store).forEach(k => delete store[k]); },
        get length() { return Object.keys(store).length; },
        key: (index: number) => Object.keys(store)[index] ?? null,
    };
};

beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock());

    // 重置 document 上所有 Symbol 键
    for (const key of Object.getOwnPropertySymbols(document)) {
        delete (document as any)[key];
    }
    for (const key of Object.getOwnPropertySymbols(document.documentElement)) {
        delete (document.documentElement as any)[key];
    }
    // @ts-ignore
    document.removeAllListeners?.();
});
```

- [ ] **Step 2: Remove old modules and write `src/errors.ts`**

Delete `src/domain/`, `src/infrastructure/`, `src/application/` entirely. Create `src/errors.ts` with the `LibraryError` + child classes listed above.

- [ ] **Step 3: Replace `src/document-binder.ts` and update `src/index.ts`**

`src/document-binder.ts` becomes:

```ts
// Temporary transit file; will be removed once core modules land.
export {};
```

`src/index.ts` becomes:

```ts
export * from './core/index';
export * from './errors';
```

`src/core/index.ts`:

```ts
export {}; // populated in later tasks
```

- [ ] **Step 4: Update `package.json` + `README.md`**

`package.json`:

```json
"description": "For private use. A function-first IoC container hosted on HTML objects.",
"keywords": ["private-use", "html", "document-context", "ioc", "context", "fp", "functional", "html-bridge"]
```

`README.md`: keep the title and replace the description line with:

```
For private use. A function-first IoC container hosted on HTML objects.
```

- [ ] **Step 5: Run tests**

Run: `npx vitest --run`
Expected: failing — there are no tests yet, but the suite must still launch and only report missing test files, not TypeScript or module-resolution errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: bootstrap fp IoC core; remove theme + dispatcher surface"
```

---

### Task 2: Internal Session Token + Symbol Branding

**Files:**
- Create: `src/core/internals/branding.ts`
- Create: `src/core/internals/session.ts`
- Modify: `src/core/internals/index.ts` (new)
- Modify: `src/core/index.ts` (re-export session)
- Test: `test/core.test.ts`

**Interfaces:**
- Produces:
  - `export const SessionBrand: unique symbol;`
  - `export const InternalWriteSymbol: unique symbol;`
  - `export interface ISession<S extends IState> { readonly [SessionBrand]: true; readonly target: object; readonly schemas: S; readonly options: Readonly<IMountOptions<S>>; readonly store: IStateStore<S>; }`
  - `export interface IState extends Record<PropertyKey, unknown> {}`
  - `export interface IMountOptions<S extends IState> { readonly scope?: IScopeToken<unknown>; readonly sync?: IBridgeOptions<S>; readonly lenient?: boolean; }`
  - `export interface IBridgeOptions<S extends IState> { readonly target: object; readonly properties: { readonly [K in keyof S]?: string } | { readonly selectAll: true }; readonly events?: readonly string[]; readonly batch?: boolean; readonly conflict?: 'lastWriteWins' | 'statePrecedence' | 'domPrecedence'; readonly ignoreInternalWrite?: boolean; readonly deepFreeze?: boolean; }`
  - `export interface IStateStore<S extends IState> { readonly state$: BehaviorSubject<Readonly<S>>; getValue(): Readonly<S>; update(partial: Partial<S>): Readonly<S>; replace(next: S): Readonly<S>; }`

- [ ] **Step 1: Write failing tests**

Create `test/core.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SessionBrand, type ISession } from '../src/core/index';
import type { IState } from '../src/core/index';

interface Counter extends IState { count: number }

const fake = (): ISession<Counter> => ({ [SessionBrand]: true, target: {}, schemas: { count: 0 }, options: { sync: undefined, scope: undefined, lenient: false }, store: undefined as any });

describe('SessionBrand', () => {
    it('exposes a unique symbol', () => {
        expect(typeof SessionBrand).toBe('symbol');
    });

    it('an object flagged with SessionBrand reads back true', () => {
        const s = fake();
        expect((s as any)[SessionBrand]).toBe(true);
    });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

Run: `npx vitest run test/core.test.ts`
Expected: FAIL because `SessionBrand` and `ISession` aren’t exported yet.

- [ ] **Step 3: Implement `src/core/internals/branding.ts`**

```ts
export const SessionBrand: unique symbol = Symbol('SandladaSessionBrand');
export const InternalWriteSymbol: unique symbol = Symbol('InternalWrite');
export const ScopeBrand: unique symbol = Symbol('SandladaScopeBrand');
```

- [ ] **Step 4: Implement `src/core/internals/session.ts`**

```ts
import type { BehaviorSubject } from 'rxjs';
import { SessionBrand } from './branding';

export interface IState extends Record<PropertyKey, unknown> {}

export interface IMountOptions<S extends IState> {
    readonly scope?: any;
    readonly sync?: IBridgeOptions<S>;
    readonly lenient?: boolean;
}

export interface IBridgeOptions<S extends IState> {
    readonly target: object;
    readonly properties:
        | { readonly [K in keyof S]?: string }
        | { readonly selectAll: true };
    readonly events?: readonly string[];
    readonly batch?: boolean;
    readonly conflict?: 'lastWriteWins' | 'statePrecedence' | 'domPrecedence';
    readonly ignoreInternalWrite?: boolean;
    readonly deepFreeze?: boolean;
}

export interface IStateStore<S extends IState> {
    readonly state$: BehaviorSubject<Readonly<S>>;
    getValue(): Readonly<S>;
    update(partial: Partial<S>): Readonly<S>;
    replace(next: S): Readonly<S>;
}

export interface ISession<S extends IState> {
    readonly [SessionBrand]: true;
    readonly target: object;
    readonly schemas: S;
    readonly options: Readonly<IMountOptions<S>>;
    readonly store: IStateStore<S>;
}
```

- [ ] **Step 5: Implement `src/core/internals/index.ts`**

```ts
export * from './branding';
export * from './session';
```

- [ ] **Step 6: Re-export from `src/core/index.ts`**

```ts
export * from './internals/index';
```

- [ ] **Step 7: Run tests to confirm PASS**

Run: `npx vitest run test/core.test.ts`
Expected: PASS for both `it` cases.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): add opaque session token + branding symbols"
```

---

### Task 3: Pure State Store

**Files:**
- Create: `src/core/state-store.ts`
- Modify: `src/core/index.ts`
- Test: `test/core.test.ts` (append)

**Interfaces:**
- Produces:
  - `export function createStateStore<S extends IState>(initial: S, opts?: { deepFreeze?: boolean }): IStateStore<S>;`

- [ ] **Step 1: Write failing tests**

Append to `test/core.test.ts`:

```ts
import { createStateStore } from '../src/core/index';

describe('createStateStore', () => {
    it('returns the initial value', () => {
        const store = createStateStore({ count: 0 });
        expect(store.getValue()).toEqual({ count: 0 });
    });

    it('update returns a new reference and leaves the previous value intact', () => {
        const store = createStateStore<{ count: number; label: string }>({ count: 0, label: 'a' });
        const before = store.getValue();
        const next = store.update({ count: 1 });
        expect(next).not.toBe(before);
        expect(before.count).toBe(0);
        expect(next.count).toBe(1);
        expect(next.label).toBe('a');
    });

    it('update is shallow: nested objects are shared by reference unless replace() is used', () => {
        const store = createStateStore<{ user: { name: string } }>({ user: { name: 'k' } });
        const before = store.getValue();
        store.update({ user: { name: 'k' } });
        expect(store.getValue()).not.toBe(before);
        expect(store.getValue().user).toEqual({ name: 'k' });
    });

    it('replace swaps the entire state and emits a new reference', () => {
        const store = createStateStore<{ count: number }>({ count: 0 });
        const replaced = store.replace({ count: 9 });
        expect(replaced).toEqual({ count: 9 });
        expect(store.getValue()).toEqual({ count: 9 });
    });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

Run: `npx vitest run test/core.test.ts`
Expected: FAIL — `createStateStore` is undefined.

- [ ] **Step 3: Implement `src/core/state-store.ts`**

```ts
import { BehaviorSubject } from 'rxjs';
import type { IState, IStateStore } from './internals/session';

const shallowFreeze = <S extends IState>(state: S): Readonly<S> => Object.freeze({ ...state });

export function createStateStore<S extends IState>(
    initial: S,
    opts: { deepFreeze?: boolean } = {},
): IStateStore<S> {
    const subject = new BehaviorSubject<Readonly<S>>(shallowFreeze(initial));
    const deep = opts.deepFreeze === true;
    const freeze = (state: S): Readonly<S> =>
        (deep ? deepFreezeImpl(state) : shallowFreeze(state)) as Readonly<S>;
    return {
        state$: subject,
        getValue: () => subject.getValue(),
        update: (partial) => {
            const next = freeze({ ...subject.getValue(), ...partial });
            subject.next(next);
            return next;
        },
        replace: (next) => {
            const v = freeze(next);
            subject.next(v);
            return v;
        },
    };
}

function deepFreezeImpl<T>(value: T): Readonly<T> {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const k of Object.keys(value as any)) {
            (value as any)[k] = deepFreezeImpl((value as any)[k]);
        }
        Object.freeze(value);
    }
    return value;
}
```

- [ ] **Step 4: Re-export from `src/core/index.ts`**

Append: `export * from './state-store';`

- [ ] **Step 5: Run tests to confirm PASS**

Run: `npx vitest run test/core.test.ts`
Expected: PASS for all 4 cases.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): add immutable state store with optional deep freeze"
```

---

### Task 4: `createContext` + `defineScope` + `IContext`

**Files:**
- Create: `src/core/context.ts`
- Create: `src/core/scope.ts`
- Modify: `src/core/index.ts`
- Test: `test/core.test.ts` (append)

**Interfaces:**
- Produces:
  - `export function createContext<S extends IState>(initial: S): IContext<S>;`
  - `export function defineScope<T = unknown>(name: string): IScopeToken<T>;`
  - `export interface IContext<S extends IState> { readonly schema: S; readonly seed?: never; }`
  - `export interface IScopeToken<T> { readonly [ScopeBrand]: true; readonly name: string; readonly __type?: T; }`

- [ ] **Step 1: Write failing tests**

Append to `test/core.test.ts`:

```ts
import { createContext, defineScope } from '../src/core/index';

describe('createContext', () => {
    it('infers the state shape from the initial value', () => {
        const ctx = createContext({ count: 0, label: 'a' });
        expect(ctx.schema).toEqual({ count: 0, label: 'a' });
    });

    it('returning a new ctx does not mutate the schema', () => {
        const ctx = createContext({ count: 0 });
        (ctx.schema as any).count = 99;
        expect(ctx.schema.count).toBe(99); // surface: developer-visible
    });
});

describe('defineScope', () => {
    it('returns a token carrying the supplied name', () => {
        const t = defineScope('document');
        expect(t.name).toBe('document');
        expect(typeof t).toBe('object');
    });

    it('two tokens with the same name remain distinct objects', () => {
        expect(defineScope('x')).not.toBe(defineScope('x'));
    });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

Run: `npx vitest run test/core.test.ts`
Expected: FAIL because `createContext` / `defineScope` not defined.

- [ ] **Step 3: Implement `src/core/scope.ts`**

```ts
import { ScopeBrand } from './internals/branding';

export interface IScopeToken<T> {
    readonly [ScopeBrand]: true;
    readonly name: string;
    readonly __type?: T;
}

export function defineScope<T = unknown>(name: string): IScopeToken<T> {
    return { [ScopeBrand]: true, name } as IScopeToken<T>;
}
```

- [ ] **Step 4: Implement `src/core/context.ts`**

```ts
import type { IState } from './internals/session';

export interface IContext<S extends IState> {
    readonly schema: S;
    readonly seed?: never;
}

export function createContext<S extends IState>(initial: S): IContext<S> {
    return { schema: initial };
}
```

- [ ] **Step 5: Wire exports**

`src/core/index.ts`:

```ts
export * from './internals/index';
export * from './state-store';
export * from './context';
export * from './scope';
```

- [ ] **Step 6: Run tests to confirm PASS**

Run: `npx vitest run test/core.test.ts`
Expected: PASS for both `describe` blocks.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add createContext + defineScope"
```

---

### Task 5: `mount`, `readState`, `updateState`, `subscribeState`

**Files:**
- Create: `src/core/mount.ts`
- Create: `src/core/read-state.ts`
- Create: `src/core/update-state.ts`
- Create: `src/core/subscribe-state.ts`
- Modify: `src/core/index.ts`
- Test: `test/core.test.ts` (append) + new `test/integration.test.ts`

**Interfaces:**
- Produces:
  - `export function mount<S extends IState>(target: object, ctx: IContext<S>, options?: IMountOptions<S>): ISession<S>;`
  - `export function readState<S extends IState>(session: ISession<S>): Readonly<S>;`
  - `export function updateState<S extends IState>(session: ISession<S>, partial: Partial<S>): Readonly<S>;`
  - `export function subscribeState<S extends IState>(session: ISession<S>, fn: (state: Readonly<S>) => void): () => void;`

- [ ] **Step 1: Write failing tests**

Append to `test/core.test.ts`:

```ts
import { mount, readState, updateState, subscribeState, SessionBrand } from '../src/core/index';

describe('mount', () => {
    it('creates an opaque session token', () => {
        const ctx = createContext({ count: 0 });
        const s = mount(document, ctx);
        expect((s as any)[SessionBrand]).toBe(true);
        expect(s.target).toBe(document);
    });

    it('is idempotent — repeated mount returns the same token', () => {
        const ctx = createContext({ count: 0 });
        const a = mount(document, ctx);
        const b = mount(document, ctx);
        expect(a).toBe(b);
    });

    it('fresh state per mount call when target is unique', () => {
        const a = mount(document, createContext({ count: 0 }));
        const b = mount(document.body, createContext({ count: 0 }));
        updateState(a, { count: 1 });
        expect(readState(b).count).toBe(0);
    });
});

describe('readState / updateState', () => {
    it('returns the initial state', () => {
        const s = mount(document, createContext({ count: 0 }));
        expect(readState(s)).toEqual({ count: 0 });
    });

    it('updateState returns the new state and reflects on readState', () => {
        const s = mount(document, createContext({ count: 0 }));
        const next = updateState(s, { count: 5 });
        expect(next.count).toBe(5);
        expect(readState(s).count).toBe(5);
    });
});

describe('subscribeState', () => {
    it('emits the next state after each updateState', () => {
        const s = mount(document, createContext({ count: 0 }));
        const seen: number[] = [];
        const unsub = subscribeState(s, (st) => seen.push(st.count));
        updateState(s, { count: 1 });
        updateState(s, { count: 2 });
        unsub();
        updateState(s, { count: 3 });
        expect(seen).toEqual([1, 2]);
    });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

Run: `npx vitest run test/core.test.ts`
Expected: FAIL — functions missing.

- [ ] **Step 3: Implement `src/core/mount.ts`**

```ts
import { createStateStore } from './state-store';
import type { IContext } from './context';
import { SessionBrand } from './internals/branding';
import type { IState, ISession, IMountOptions } from './internals/session';

// Symbol-keyed cache to guarantee idempotency per target.
const TARGET_CACHE: WeakMap<object, ISession<any>[]> = new WeakMap();

function attachSession<S extends IState>(target: object, session: ISession<S>): void {
    const list = TARGET_CACHE.get(target);
    if (list) list.push(session);
    else TARGET_CACHE.set(target, [session]);
}

export function mount<S extends IState>(
    target: object,
    ctx: IContext<S>,
    options: IMountOptions<S> = {},
): ISession<S> {
    if (!ctx || typeof ctx !== 'object' || ctx.schema === undefined) {
        throw new Error('mount: invalid context. Did you call createContext()?');
    }
    const list = TARGET_CACHE.get(target);
    if (list) {
        for (const s of list as ISession<S>[]) {
            if (s.target === target && s.schemas === ctx.schema) return s;
        }
    }
    const store = createStateStore(ctx.schema);
    const session: ISession<S> = {
        [SessionBrand]: true,
        target,
        schemas: ctx.schema,
        options,
        store,
    };
    attachSession(target, session);
    return session;
}
```

- [ ] **Step 4: Implement `src/core/read-state.ts`**

```ts
import type { ISession, IState } from './internals/session';

export function readState<S extends IState>(session: ISession<S>): Readonly<S> {
    return session.store.getValue();
}
```

- [ ] **Step 5: Implement `src/core/update-state.ts`**

```ts
import type { ISession, IState } from './internals/session';

export function updateState<S extends IState>(
    session: ISession<S>,
    partial: Partial<S>,
): Readonly<S> {
    return session.store.update(partial);
}
```

- [ ] **Step 6: Implement `src/core/subscribe-state.ts`**

```ts
import type { Subscription } from 'rxjs';
import type { ISession, IState } from './internals/session';

export function subscribeState<S extends IState>(
    session: ISession<S>,
    fn: (state: Readonly<S>) => void,
): () => void {
    const sub: Subscription = session.store.state$.subscribe((s) => fn(s as Readonly<S>));
    return () => sub.unsubscribe();
}
```

- [ ] **Step 7: Re-export and rerun tests**

Append to `src/core/index.ts`:

```ts
export * from './mount';
export * from './read-state';
export * from './update-state';
export * from './subscribe-state';
```

Run: `npx vitest run test/core.test.ts`
Expected: PASS for all new tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): add mount, readState, updateState, subscribeState"
```

---

### Task 6: `provide` / `inject` + Scope Chain

**Files:**
- Create: `src/core/provide.ts`
- Create: `src/core/inject.ts`
- Modify: `src/core/index.ts`
- Test: `test/core.test.ts` (append)

**Interfaces:**
- Produces:
  - `export function provide<T, S extends IState>(session: ISession<S>, token: IScopeToken<T> | string, factory: () => T, options?: { lifecycle?: 'singleton' | 'transient' | 'scoped' }): void;`
  - `export function inject<T, S extends IState>(session: ISession<S>, token: IScopeToken<T> | string): T;`

- [ ] **Step 1: Write failing tests**

Append to `test/core.test.ts`:

```ts
import { provide, inject } from '../src/core/index';

describe('provide/inject', () => {
    it('resolves a singleton at the session scope', () => {
        const s = mount(document, createContext({}));
        const TOKEN = defineScope<string>('thing');
        provide(s, TOKEN, () => 'hi');
        expect(inject(s, TOKEN)).toBe('hi');
    });

    it('transient returns a new instance each call', () => {
        const s = mount(document, createContext({}));
        const T = defineScope<{ id: number }>('inst');
        let n = 0;
        provide(s, T, () => ({ id: ++n }), { lifecycle: 'transient' });
        expect(inject(s, T)).not.toBe(inject(s, T));
        expect((inject(s, T) as any).id).not.toBe((inject(s, T) as any).id);
    });

    it('scoped shares one instance per session', () => {
        const s1 = mount(document, createContext({}));
        const s2 = mount(document.body, createContext({}));
        const T = defineScope<{ id: number }>('shared');
        let n = 0;
        provide(s1, T, () => ({ id: ++n }), { lifecycle: 'scoped' });
        expect(inject(s1, T)).toBe(inject(s1, T));
        expect(inject(s1, T)).not.toBe(inject(s2, T));
    });

    it('singleton shares across sessions', () => {
        const s1 = mount(document, createContext({}));
        const s2 = mount(document.body, createContext({}));
        const T = defineScope<{ id: number }>('single');
        provide(s1, T, () => ({ id: 42 }));
        expect(inject(s2, T)).toEqual({ id: 42 });
    });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

Run: `npx vitest run test/core.test.ts`
Expected: FAIL — provide/inject undefined.

- [ ] **Step 3: Implement `src/core/provide.ts`**

```ts
import { ScopeBrand } from './internals/branding';
import type { ISession, IState } from './internals/session';

interface IRegistryEntry {
    value?: unknown;
    factory: () => unknown;
    lifecycle: 'singleton' | 'transient' | 'scoped';
}

const REGISTRY = new WeakMap<ISession<any>, Map<unknown, IRegistryEntry>>();
const SINGLETON_CACHE = new Map<unknown, unknown>();

function resolveKey(token: unknown): unknown {
    return token;
}

export function provide<T, S extends IState>(
    session: ISession<S>,
    token: any,
    factory: () => T,
    options: { lifecycle?: 'singleton' | 'transient' | 'scoped' } = {},
): void {
    const lifecycle = options.lifecycle ?? 'singleton';
    let map = REGISTRY.get(session);
    if (!map) {
        map = new Map();
        REGISTRY.set(session, map);
    }
    map.set(resolveKey(token), { factory, lifecycle });
}
```

- [ ] **Step 4: Implement `src/core/inject.ts`**

```ts
import { CircularDependencyError, UnknownServiceError } from '../errors';
import { ScopeBrand } from './internals/branding';
import type { ISession, IState } from './internals/session';

interface IRegistryEntry {
    value?: unknown;
    factory: () => unknown;
    lifecycle: 'singleton' | 'transient' | 'scoped';
}

const REGISTRY = new WeakMap<ISession<any>, Map<unknown, IRegistryEntry>>();
const SINGLETON_CACHE = new Map<unknown, unknown>();
const CALL_STACK = new WeakMap<ISession<any>, Set<unknown>>();

function findSessionWithToken(start: ISession<any>, key: unknown): ISession<any> | undefined {
    const seen = new Set<object>();
    let cur: ISession<any> | undefined = start;
    while (cur) {
        if (seen.has(cur as any)) break;
        seen.add(cur as any);
        const m = REGISTRY.get(cur);
        if (m?.has(key)) return cur;
        cur = (cur.options.scope as any)?.parent ?? undefined;
    }
    return undefined;
}

export function inject<T, S extends IState>(session: ISession<S>, token: any): T {
    const owner = findSessionWithToken(session, token);
    if (!owner) throw new UnknownServiceError(`Unknown service token: ${String(token)}`);

    let stack = CALL_STACK.get(session);
    if (!stack) { stack = new Set(); CALL_STACK.set(session, stack); }
    if (stack.has(token)) {
        throw new CircularDependencyError(Array.from(stack as any) as unknown as string[]);
    }
    const map = REGISTRY.get(owner);
    if (!map) throw new UnknownServiceError(`Unknown service token: ${String(token)}`);

    const entry = map.get(token)!;
    stack.add(token);
    try {
        switch (entry.lifecycle) {
            case 'singleton': {
                if (!SINGLETON_CACHE.has(token)) {
                    SINGLETON_CACHE.set(token, entry.factory());
                }
                return SINGLETON_CACHE.get(token) as T;
            }
            case 'transient':
                return entry.factory() as T;
            case 'scoped': {
                if (entry.value === undefined) entry.value = entry.factory();
                return entry.value as T;
            }
        }
    } finally {
        stack.delete(token);
    }
}
```

- [ ] **Step 5: Wire exports**

Append to `src/core/index.ts`:

```ts
export * from './provide';
export * from './inject';
```

- [ ] **Step 6: Run tests to confirm PASS**

Run: `npx vitest run test/core.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add provide/inject with singleton/transient/scoped"
```

---

### Task 7: localStorage Adapter + `saveState` / `loadState`

**Files:**
- Create: `src/adapters/local-storage.ts`
- Create: `src/core/save-state.ts`
- Create: `src/core/load-state.ts`
- Modify: `src/core/index.ts`
- Test: `test/integration.test.ts` (append)

**Interfaces:**
- Produces:
  - `export function saveState<S extends IState>(session: ISession<S>, opts: { adapter: 'localStorage'; key: string }): void;`
  - `export function loadState<S extends IState>(session: ISession<S>, opts: { adapter: 'localStorage'; key: string }): void;`

- [ ] **Step 1: Write failing tests**

Create `test/integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createContext, mount, updateState, readState, saveState, loadState } from '../src/core/index';

describe('localStorage adapter', () => {
    it('saveState + loadState round-trip', () => {
        const s = mount(document, createContext({ count: 0, label: 'a' }));
        updateState(s, { count: 7 });
        saveState(s, { adapter: 'localStorage', key: 'demo' });
        updateState(s, { count: 0, label: 'x' });
        loadState(s, { adapter: 'localStorage', key: 'demo' });
        expect(readState(s)).toEqual({ count: 7, label: 'a' });
    });

    it('loadState falls back to current state on invalid JSON', () => {
        localStorage.setItem('bad', 'not-json');
        const s = mount(document, createContext({ count: 1 }));
        loadState(s, { adapter: 'localStorage', key: 'bad' });
        expect(readState(s).count).toBe(1);
    });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

Run: `npx vitest run test/integration.test.ts`
Expected: FAIL — symbols undefined.

- [ ] **Step 3: Implement `src/adapters/local-storage.ts`**

```ts
export interface IStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const localStorageAdapter: IStorageLike = {
    getItem: (k) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(k)),
    setItem: (k, v) => localStorage.setItem(k, v),
};

export function getStorageAdapter(name: 'localStorage'): IStorageLike {
    if (name !== 'localStorage') throw new Error('Unknown adapter: ' + name);
    return localStorageAdapter;
}
```

- [ ] **Step 4: Implement `src/core/save-state.ts`**

```ts
import { getStorageAdapter } from '../adapters/local-storage';
import { readState } from './read-state';
import type { ISession, IState } from './internals/session';

export function saveState<S extends IState>(
    session: ISession<S>,
    opts: { adapter: 'localStorage'; key: string },
): void {
    const state = readState(session) as any;
    const adapter = getStorageAdapter(opts.adapter);
    adapter.setItem(opts.key, JSON.stringify(state));
}
```

- [ ] **Step 5: Implement `src/core/load-state.ts`**

```ts
import { getStorageAdapter } from '../adapters/local-storage';
import { InvalidStoredStateError } from '../errors';
import { sessionReplace } from './internals/state-mutations';
import type { ISession, IState } from './internals/session';

export function loadState<S extends IState>(
    session: ISession<S>,
    opts: { adapter: 'localStorage'; key: string },
): void {
    const adapter = getStorageAdapter(opts.adapter);
    const raw = adapter.getItem(opts.key);
    if (raw === null) return;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') throw new InvalidStoredStateError('not object');
        sessionReplace(session as any, parsed as S);
    } catch (e) {
        if (e instanceof InvalidStoredStateError) return;
        // Keep silent for corrupt JSON: keep current state (spec requirement).
    }
}
```

- [ ] **Step 6: Implement `src/core/internals/state-mutations.ts`**

```ts
import type { ISession, IState } from './session';

export function sessionReplace<S extends IState>(session: ISession<S>, next: S): void {
    session.store.replace(next);
}
```

- [ ] **Step 7: Re-export**

Append to `src/core/index.ts`:

```ts
export * from './save-state';
export * from './load-state';
```

- [ ] **Step 8: Run tests to confirm PASS**

Run: `npx vitest run test/integration.test.ts`
Expected: PASS for both tests.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(adapters): add localStorage adapter + saveState/loadState"
```

---

### Task 8: Bidirectional Property Sync (`bridgeState` + `mount({ sync })`)

**Files:**
- Create: `src/core/bridge.ts`
- Create: `src/core/internals/property-path.ts`
- Modify: `src/core/mount.ts` (invoke sync on mount)
- Modify: `src/core/index.ts`
- Test: `test/integration.test.ts` (append)

**Interfaces:**
- Produces:
  - `export function bridgeState<S extends IState>(session: ISession<S>, options: IBridgeOptions<S>): () => void;`
  - Internal `property-path.ts`: `export function readPropertyPath(target: any, path: string): unknown; export function writePropertyPath(target: any, path: string, value: unknown): void;`

- [ ] **Step 1: Write failing tests**

Append to `test/integration.test.ts`:

```ts
import { bridgeState } from '../src/core/index';

describe('bridgeState', () => {
    it('JS → DOM: updateState writes to target property', () => {
        const s = mount(document, createContext<{ count: number; label: string }>({ count: 1, label: 'en' }));
        bridgeState(s, { target: document.documentElement, properties: { count: 'dataset.count', label: 'lang' }, ignoreInternalWrite: true });
        updateState(s, { count: 9, label: 'fr' });
        expect(document.documentElement.dataset.count).toBe('9');
        expect(document.documentElement.lang).toBe('fr');
    });

    it('DOM → JS: input event reads back into state', () => {
        const s = mount(document, createContext<{ label: string }>({ label: 'en' }));
        bridgeState(s, { target: document.documentElement, properties: { label: 'lang' }, events: ['input'], batch: false, ignoreInternalWrite: true });
        document.documentElement.lang = 'zh';
        document.documentElement.dispatchEvent(new Event('input', { bubbles: true }));
        expect(readState(s).label).toBe('zh');
    });

    it('ignoreInternalWrite breaks the loop', () => {
        const s = mount(document, createContext<{ label: string }>({ label: 'en' }));
        bridgeState(s, { target: document.documentElement, properties: { label: 'lang' }, ignoreInternalWrite: true });
        let count = 0;
        subscribeState(s, () => count++);
        document.documentElement.dispatchEvent(new Event('input', { bubbles: true }));
        expect(count).toBe(0);
    });

    it('batch: true coalesces writes within a microtask', async () => {
        const s = mount(document, createContext<{ count: number }>({ count: 0 }));
        bridgeState(s, { target: document.documentElement, properties: { count: 'dataset.count' }, batch: true });
        updateState(s, { count: 1 });
        updateState(s, { count: 2 });
        await Promise.resolve();
        expect(document.documentElement.dataset.count).toBe('2');
    });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

Run: `npx vitest run test/integration.test.ts`
Expected: FAIL — bridgeState undefined, `dataset.count` not updated yet.

- [ ] **Step 3: Implement `src/core/internals/property-path.ts`**

```ts
export function readPropertyPath(target: any, path: string): unknown {
    if (path.indexOf('.') === -1) return target[path];
    const parts = path.split('.');
    let cur = target;
    for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
    }
    return cur;
}

export function writePropertyPath(target: any, path: string, value: unknown): void {
    if (path.indexOf('.') === -1) { target[path] = value; return; }
    const parts = path.split('.');
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = value;
}
```

- [ ] **Step 4: Implement `src/core/bridge.ts`**

```ts
import { InternalWriteSymbol } from './internals/branding';
import { readPropertyPath, writePropertyPath } from './internals/property-path';
import type { IBridgeOptions, ISession, IState } from './internals/session';

export function bridgeState<S extends IState>(
    session: ISession<S>,
    options: IBridgeOptions<S>,
): () => void {
    const target = options.target;
    const events = options.events ?? ['input', 'change'];
    const batch = options.batch ?? true;
    const ignoreInternal = options.ignoreInternalWrite ?? true;

    const propertyEntries: Array<{ key: keyof S & string; path: string }> =
        'selectAll' in options.properties
            ? (Object.keys(session.schemas) as Array<keyof S & string>).map((k) => ({ key: k, path: k }))
            : (Object.entries(options.properties) as Array<[string, string]>).map(([k, p]) => ({ key: k, path: p! }));

    // JS → DOM
    const lastWritten: Map<string, unknown> = new Map();
    let pendingMicrotask: number | null = null;

    const flush = () => {
        pendingMicrotask = null;
        for (const { key, path } of propertyEntries) {
            const v = readPropertyPath(target, path);
            const expected = session.store.getValue()[key];
            if (v !== expected) {
                if (ignoreInternal) (target as any)[InternalWriteSymbol] = true;
                writePropertyPath(target, path, expected);
                if (ignoreInternal) delete (target as any)[InternalWriteSymbol];
                lastWritten.set(key, expected);
            }
        }
    };

    const subscription = session.store.state$.subscribe(() => {
        if (batch) {
            if (pendingMicrotask === null) {
                pendingMicrotask = queueMicrotask(() => flush());
            }
        } else {
            flush();
        }
    });

    // DOM → JS
    const onEvent = (ev: Event) => {
        if (ignoreInternal && (target as any)[InternalWriteSymbol]) return;
        const partial: Partial<S> = {};
        let changed = false;
        for (const { key, path } of propertyEntries) {
            const v = readPropertyPath(target, path);
            if (v !== session.store.getValue()[key]) {
                (partial as any)[key] = v;
                changed = true;
            }
        }
        if (changed) session.store.update(partial);
    };

    const listeners: Array<{ name: string; bound: (e: Event) => void }> = [];
    for (const name of events) {
        const bound = (e: Event) => onEvent(e);
        target.addEventListener(name, bound as any);
        listeners.push({ name, bound });
    }

    // Initial sync
    flush();

    return () => {
        subscription.unsubscribe();
        if (pendingMicrotask !== null) cancelMicrotask?.(pendingMicrotask as any);
        for (const { name, bound } of listeners) {
            target.removeEventListener(name, bound as any);
        }
    };
}
```

- [ ] **Step 5: Wire into `mount()`**

Modify `src/core/mount.ts` — append after `attachSession`:

```ts
import { bridgeState } from './bridge';

const BRIDGE_REGISTRY = new WeakMap<ISession<any>, () => void>();

export function mount<S extends IState>(
    target: object,
    ctx: IContext<S>,
    options: IMountOptions<S> = {},
): ISession<S> {
    // existing body, then:
    if (options.sync) {
        const dispose = bridgeState(session, options.sync);
        BRIDGE_REGISTRY.set(session, dispose);
    }
    return session;
}
```

- [ ] **Step 6: Wire exports**

Append to `src/core/index.ts`:

```ts
export * from './bridge';
```

- [ ] **Step 7: Run tests to confirm PASS**

Run: `npx vitest run test/integration.test.ts`
Expected: PASS for all bridge tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): add bidirectional property bridge (bridgeState)"
```

---

### Task 9: `dispose` + auto cleanup via MutationObserver

**Files:**
- Create: `src/core/dispose.ts`
- Create: `src/adapters/dom-mutation.ts`
- Modify: `src/core/mount.ts`
- Modify: `src/core/index.ts`
- Test: `test/integration.test.ts` (append)

**Interfaces:**
- Produces:
  - `export function dispose<S extends IState>(session: ISession<S>): void;`
  - Adapter: detects element removal via `MutationObserver`.

- [ ] **Step 1: Write failing tests**

Append to `test/integration.test.ts`:

```ts
import { dispose } from '../src/core/index';

describe('dispose', () => {
    it('removes the listener and the bridge subscription', () => {
        const s = mount(document.createElement('div'), createContext({ count: 0 }));
        bridgeState(s, { target: document.body, properties: { count: 'dataset.count' }, ignoreInternalWrite: true });
        dispose(s);
        expect(() => updateState(s, { count: 9 })).toThrow();
    });

    it('disconnect via MutationObserver when target is removed', async () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const s = mount(el, createContext({ count: 0 }));
        document.body.removeChild(el);
        await new Promise((r) => setTimeout(r, 50));
        expect(() => readState(s)).toThrow();
    });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

Run: `npx vitest run test/integration.test.ts`
Expected: FAIL — dispose undefined, no auto-cleanup yet.

- [ ] **Step 3: Implement `src/adapters/dom-mutation.ts`**

```ts
const observers = new WeakMap<object, MutationObserver>();

export function watchRemoval(target: Node, onRemove: () => void): () => void {
    const parent = target.parentNode ?? document.body;
    const obs = new MutationObserver((records) => {
        for (const r of records) {
            if (r.removedNodes.length > 0 && Array.from(r.removedNodes).includes(target)) {
                onRemove();
                obs.disconnect();
                observers.delete(target);
                return;
            }
        }
    });
    if (parent) obs.observe(parent, { childList: true });
    observers.set(target, obs);
    return () => { obs.disconnect(); observers.delete(target); };
}
```

- [ ] **Step 4: Implement `src/core/dispose.ts`**

```ts
import { watchRemoval } from '../adapters/dom-mutation';
import type { ISession, IState } from './internals/session';

const BRIDGE_REGISTRY = new WeakMap<ISession<any>, () => void>();

export function dispose<S extends IState>(session: ISession<S>): void {
    const disposer = BRIDGE_REGISTRY.get(session);
    if (disposer) {
        disposer();
        BRIDGE_REGISTRY.delete(session);
    }
    // Mark session as invalidated: subsequent reads throw.
    Object.defineProperty(session, 'store', { get() { throw new Error('Session was disposed.'); }, configurable: true });
}
```

- [ ] **Step 5: Wire into mount**

In `src/core/mount.ts` after the existing body:

```ts
if (typeof Node !== 'undefined' && target instanceof Node) {
    const registry = BRIDGE_REGISTRY.get(session);
    watchRemoval(target, () => dispose(session));
}
```

- [ ] **Step 6: Wire exports**

Append to `src/core/index.ts`:

```ts
export * from './dispose';
```

- [ ] **Step 7: Run tests to confirm PASS**

Run: `npx vitest run test/integration.test.ts`
Expected: PASS for both dispose tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): add dispose + auto cleanup via MutationObserver"
```

---

### Task 10: Circular Dependency Detection Tests + `error$`

**Files:**
- Create: `src/core/error-stream.ts`
- Modify: `src/core/inject.ts` (emit on cycle)
- Modify: `src/core/index.ts`
- Test: `test/core.test.ts` (append)

**Interfaces:**
- Produces:
  - `export function readErrorStream(session: ISession<any>): Observable<LibraryError>;`
- Adds `WeakMap` of `Subject<LibraryError>` per session.

- [ ] **Step 1: Write failing tests**

Append to `test/core.test.ts`:

```ts
import { readErrorStream } from '../src/core/index';
import { CircularDependencyError } from '../src/errors';
import type { Subscription } from 'rxjs';

describe('inject circular dependency', () => {
    it('throws with cycle path', () => {
        const s = mount(document, createContext({}));
        const A = defineScope<{ b?: any }>('A');
        const B = defineScope<{ a?: any }>('B');
        provide(s, A, () => ({ b: inject(s, B) }));
        expect(() => provide(s, B, () => ({ a: inject(s, A) }))).toThrow(CircularDependencyError);
    });

    it('errorStream receives the error event', () => {
        const s = mount(document, createContext({}));
        const A = defineScope<{ b?: any }>('A1');
        const B = defineScope<{ a?: any }>('B1');
        provide(s, A, () => ({ b: inject(s, B) }));
        const errors: LibraryError[] = [];
        const sub: Subscription = readErrorStream(s).subscribe((e) => errors.push(e));
        let caught: unknown;
        try { provide(s, B, () => ({ a: inject(s, A) })); } catch (e) { caught = e; }
        sub.unsubscribe();
        expect(caught).toBeInstanceOf(CircularDependencyError);
        expect(errors.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

Run: `npx vitest run test/core.test.ts`
Expected: FAIL — `readErrorStream` and stream not present.

- [ ] **Step 3: Implement `src/core/error-stream.ts`**

```ts
import { Subject, type Observable } from 'rxjs';
import type { LibraryError } from '../errors';
import type { ISession, IState } from './internals/session';

const STREAMS = new WeakMap<ISession<any>, Subject<LibraryError>>();

export function readErrorStream<S extends IState>(session: ISession<S>): Observable<LibraryError> {
    let subj = STREAMS.get(session);
    if (!subj) { subj = new Subject<LibraryError>(); STREAMS.set(session, subj); }
    return subj.asObservable();
}

export function reportError(session: ISession<any>, err: LibraryError): void {
    const subj = STREAMS.get(session);
    if (subj) subj.next(err);
}
```

- [ ] **Step 4: Update `src/core/inject.ts`**

In the cycle detection branch add:

```ts
import { reportError } from './error-stream';
// ...
if (stack.has(token)) {
    const err = new CircularDependencyError(Array.from(stack as any) as unknown as string[]);
    reportError(session as any, err);
    throw err;
}
```

- [ ] **Step 5: Wire exports**

Append to `src/core/index.ts`:

```ts
export * from './error-stream';
```

- [ ] **Step 6: Run tests to confirm PASS**

Run: `npx vitest run test/core.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): emit library errors to session errorStream"
```

---

### Task 11: Public Surface Cleanup + `tsdown` + `package.json`

**Files:**
- Modify: `src/document-binder.ts` (delete file)
- Modify: `src/index.ts` (final shape)
- Modify: `package.json` (description/keywords/peer)
- Modify: `README.md`
- Modify: `tsdown.config.ts`

**Interfaces:**
- `src/index.ts`:
  ```ts
  export * from './core/index';
  export * from './errors';
  export type { Observable, Subscription } from 'rxjs';
  ```

- [ ] **Step 1: Write failing build**

Run: `npm run build`
Expected: FAIL — `document-binder` still imports removed modules.

- [ ] **Step 2: Delete `src/document-binder.ts`**

Remove the file entirely. Confirm via `ls src`.

- [ ] **Step 3: Finalize `src/index.ts`**

```ts
export * from './core/index';
export * from './errors';
export type { Observable, Subscription } from 'rxjs';

declare global {
    // Adapter hook for ambient augmentation; intentionally empty.
}
```

- [ ] **Step 4: Update `package.json`**

```json
"description": "For private use. A function-first IoC container hosted on HTML objects.",
"keywords": ["private-use", "html", "document-context", "ioc", "context", "fp", "functional", "html-bridge"]
```

- [ ] **Step 5: Update README**

Replace single-line description with:

```
For private use. A function-first IoC container hosted on HTML objects.
```

- [ ] **Step 6: Verify `tsdown.config.ts`**

Should remain unchanged (still single entry pointing at `src/index.ts`).

- [ ] **Step 7: Build and verify outputs**

Run: `npm run build`
Expected: SUCCESS. Verify `build/index.d.ts` exports `createContext`, `mount`, `readState`, `updateState`, `subscribeState`, `provide`, `inject`, `bridgeState`, `saveState`, `loadState`, `dispose`, `defineScope`, and the error classes.

- [ ] **Step 8: Final test pass**

Run: `npm test`
Expected: PASS for all suites.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: finalize public surface and package metadata"
```

---

### Task 12: Documentation Pass

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-26-document-context-refactor.md` (link the plan)

- [ ] **Step 1: Rewrite `CLAUDE.md`**

Reflect new architecture: layer-free functional core under `src/core/*`, adapter layer under `src/adapters/*`, no `domain/application/infrastructure` folders. Document public API surface, idempotency, bidirectional property bridge defaults, and the IoC lifecycle.

- [ ] **Step 2: Update README**

Add a short usage example:

```ts
import { createContext, mount, updateState, subscribeState } from '@sandlada/document-context';

const ctx = createContext({ count: 0, label: 'en' });
const session = mount(document, ctx, {
    sync: { target: document.documentElement, properties: { count: 'dataset.count', label: 'lang' } },
});
subscribeState(session, console.log);
updateState(session, { count: 1 });
```

- [ ] **Step 3: Cross-link the plan**

Append a footer to the spec linking to `docs/superpowers/plans/2026-07-26-document-context-refactor.md`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: update README + CLAUDE.md for fp IoC design"
```

---

## Plan Coverage Against the Spec

| Spec section                                | Plan task |
| -------------------------------------------- | --------- |
| §3 Layout                                    | 1, 11     |
| §4 Data models                               | 2, 3, 4   |
| §5 Top-level API                             | 4, 5, 6, 7, 8, 9 |
| §6 Bidirectional sync                        | 8, 9      |
| §7 IoC behaviors                             | 6, 10     |
| §8 Error handling                            | 1, 10     |
| §9 Tests                                     | 1, 5-10 (each task writes its tests inline) |
| §10 Public/internal surface                  | 11        |
| §11 Add/delete list                          | 1, 11     |
| §13 Acceptance                               | 11, 12    |

---

## Plan Handoff

The plan is finished and saved at `docs/superpowers/plans/2026-07-26-document-context-refactor.md`.

Two execution paths:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — batched checkpoints in the same session via `executing-plans`.

If you’d like to proceed, tell me which mode you want; I’ll then invoke `superpowers:subagent-driven-development` or `superpowers:executing-plans` accordingly.
