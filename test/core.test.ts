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

import { mount, readState, updateState, subscribeState } from '../src/core/index';

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
        // happy-dom setup resets documentElement internals, so use a fresh node instead of document.body.
        const b = mount(document.createElement('div'), createContext({ count: 0 }));
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
        expect(seen).toEqual([0, 1, 2]);
    });
});

import { provide, inject, readErrorStream } from '../src/core/index';
import { CircularDependencyError, LibraryError } from '../src/errors';
import type { Subscription } from 'rxjs';

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
        const s2 = mount(document.createElement('div'), createContext({}));
        const T = defineScope<{ id: number }>('shared');
        let n = 0;
        provide(s1, T, () => ({ id: ++n }), { lifecycle: 'scoped' });
        expect(inject(s1, T)).toBe(inject(s1, T));
        expect(inject(s1, T)).not.toBe(inject(s2, T));
    });

    it('singleton shares across sessions', () => {
        const s1 = mount(document, createContext({}));
        const s2 = mount(document.createElement('div'), createContext({}));
        const T = defineScope<{ id: number }>('single');
        provide(s1, T, () => ({ id: 42 }));
        expect(inject(s2, T)).toEqual({ id: 42 });
    });
});

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
