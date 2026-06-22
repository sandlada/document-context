import { beforeEach, vi } from 'vitest';
import { ContextSymbol, enhanceDocument } from '../src/index';
const createLocalStorageMock = () => {
    const store = {};
    return {
        getItem: (key) => store[key] ?? null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
        clear: () => { Object.keys(store).forEach(k => delete store[k]); },
        get length() { return Object.keys(store).length; },
        key: (index) => Object.keys(store)[index] ?? null,
    };
};
// 重置 document 擴展，避免 side-effect 污染
beforeEach(() => {
    // 替換 localStorage 為可靠的記憶體實作
    vi.stubGlobal('localStorage', createLocalStorageMock());
    // 清除先前 Symbol 資料（必須使用實際的 ContextSymbol，Symbol() 與 Symbol.for() 不同）
    delete document[ContextSymbol];
    // @ts-ignore
    document.removeAllListeners?.();
    enhanceDocument();
});
//# sourceMappingURL=setup.js.map