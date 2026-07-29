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

    // 重置 document.documentElement 上所有 Symbol 键。
    // 注意: 不要重置 document 自身的 Symbol,会破坏 happy-dom 内部状态
    // (例如 PropertySymbol.elementArray),导致 documentElement getter 抛错。
    for (const key of Object.getOwnPropertySymbols(document.documentElement)) {
        try {
            delete (document.documentElement as any)[key];
        } catch {
            // 跳过删除此 Symbol
        }
    }
    // @ts-ignore
    document.removeAllListeners?.();
});
