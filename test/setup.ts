import { beforeEach, vi } from 'vitest';
import { ContextSymbol, enhanceDocument } from '../src/index';

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

// 重置 document 擴展，避免 side-effect 污染
beforeEach(() => {
    // 替換 localStorage 為可靠的記憶體實作
    vi.stubGlobal('localStorage', createLocalStorageMock());

    // 清除先前 Symbol 資料（必須使用實際的 ContextSymbol，Symbol() 與 Symbol.for() 不同）
    delete (document as any)[ContextSymbol];

    // @ts-ignore
    document.removeAllListeners?.();

    enhanceDocument();
});
