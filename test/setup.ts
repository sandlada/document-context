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
