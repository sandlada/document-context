import { describe, expect, it } from 'vitest';
import { bridgeState, createContext, dispose, mount, updateState, readState, saveState, loadState, subscribeState } from '../src/core/index';

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

describe('bridgeState', () => {
    it('JS → DOM: updateState writes to target property', async () => {
        const target = document.createElement('div');
        const s = mount(document, createContext<{ count: number; label: string }>({ count: 1, label: 'en' }));
        bridgeState(s, { target, properties: { count: 'dataset.count', label: 'lang' }, ignoreInternalWrite: true });
        updateState(s, { count: 9, label: 'fr' });
        await Promise.resolve();
        expect(target.dataset.count).toBe('9');
        expect(target.lang).toBe('fr');
    });

    it('DOM → JS: input event reads back into state', () => {
        const target = document.createElement('div');
        const s = mount(document, createContext<{ label: string }>({ label: 'en' }));
        bridgeState(s, { target, properties: { label: 'lang' }, events: ['input'], batch: false, ignoreInternalWrite: true });
        target.lang = 'zh';
        target.dispatchEvent(new Event('input', { bubbles: true }));
        expect(readState(s).label).toBe('zh');
    });

    it('ignoreInternalWrite breaks the loop', () => {
        const target = document.createElement('div');
        let current = '';
        Object.defineProperty(target, 'lang', {
            configurable: true,
            get: () => current,
            set: (value: string) => {
                target.dispatchEvent(new Event('input', { bubbles: true }));
                current = value;
            },
        });
        const s = mount(document, createContext<{ label: string }>({ label: 'en' }));
        bridgeState(s, { target, properties: { label: 'lang' }, events: ['input'], batch: false, ignoreInternalWrite: true });
        let count = 0;
        subscribeState(s, () => count++);
        count = 0;
        updateState(s, { label: 'fr' });
        expect(count).toBe(1);
        expect(readState(s).label).toBe('fr');
    });

    it('batch: true coalesces writes within a microtask', async () => {
        const target = document.createElement('div');
        const s = mount(document, createContext<{ count: number }>({ count: 0 }));
        bridgeState(s, { target, properties: { count: 'dataset.count' }, batch: true });
        updateState(s, { count: 1 });
        updateState(s, { count: 2 });
        await Promise.resolve();
        expect(target.dataset.count).toBe('2');
    });
});

describe('dispose', () => {
    it('removes the listener and the bridge subscription', () => {
        const s = mount(document.createElement('div'), createContext({ count: 0 }));
        // happy-dom throws on document.body; use a fresh element instead.
        bridgeState(s, { target: document.createElement('div'), properties: { count: 'dataset.count' }, ignoreInternalWrite: true });
        dispose(s);
        expect(() => updateState(s, { count: 9 })).toThrow();
    });

    it('disconnect via MutationObserver when target is removed', async () => {
        const el = document.createElement('div');
        const host = document.createElement('div');
        host.appendChild(el);
        const s = mount(el, createContext({ count: 0 }));
        host.removeChild(el);
        await new Promise((r) => setTimeout(r, 50));
        expect(() => readState(s)).toThrow();
    });
});
