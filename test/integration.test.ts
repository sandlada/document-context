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
