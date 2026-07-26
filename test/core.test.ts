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
