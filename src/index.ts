import type { Observable } from "rxjs";
import type { IThemeRaw, ThemeEntity } from "./domain/entities/theme.entity";
import type { IBoundUseCases } from "./document-binder";
import { ContextSymbol, bindUseCasesToDocument } from "./document-binder";
import { InMemoryThemeStore } from "./infrastructure/stores/in-memory-theme.store";
import { ThemeRepository } from "./infrastructure/repositories/theme.repository";
import { DOMAttrRepository } from "./infrastructure/repositories/dom-attr.repository";
import { UpdateThemeUseCase } from "./application/use-cases/update-theme.use-case";
import { ToggleDarkModeUseCase } from "./application/use-cases/toggle-dark-mode.use-case";
import { LoadThemeFromStorageUseCase } from "./application/use-cases/load-theme-from-storage.use-case";
import { SaveThemeToStorageUseCase } from "./application/use-cases/save-theme-to-storage.use-case";
import { SyncAttrToDomUseCase } from "./application/use-cases/sync-attr-to-dom.use-case";

export { ContextSymbol } from "./document-binder";
export type { IBoundUseCases, IBinderDeps, IBinderResult } from "./document-binder";
export { ThemeEntity, type IThemeRaw } from "./domain/entities/theme.entity";
export type { IThemeRepository } from "./domain/repositories/i-theme.repository";
export type { IDOMAttrRepository } from "./domain/repositories/i-dom-attr.repository";

export { UpdateThemeUseCase } from "./application/use-cases/update-theme.use-case";
export { ToggleDarkModeUseCase } from "./application/use-cases/toggle-dark-mode.use-case";
export { LoadThemeFromStorageUseCase } from "./application/use-cases/load-theme-from-storage.use-case";
export { SaveThemeToStorageUseCase } from "./application/use-cases/save-theme-to-storage.use-case";
export { SyncAttrToDomUseCase } from "./application/use-cases/sync-attr-to-dom.use-case";

export { InMemoryThemeStore } from "./infrastructure/stores/in-memory-theme.store";
export { LocalStorageThemeStore } from "./infrastructure/stores/local-storage-theme.store";
export { ThemeMapper } from "./infrastructure/mappers/theme.mapper";
export { LocalStorageMapper } from "./infrastructure/mappers/local-storage.mapper";
export { ThemeRepository } from "./infrastructure/repositories/theme.repository";
export { DOMAttrRepository } from "./infrastructure/repositories/dom-attr.repository";

declare global {
    interface Document {
        [ContextSymbol]?: IBoundUseCases;
    }
}

/**
 * 组合根：一键初始化并将用例绑定到 document[ContextSymbol]
 * 返回绑定结果（含 subscription），调用方可按需管理生命周期
 */
export function enhanceDocument(doc: Document = document) {
    if (typeof doc === "undefined") {
        throw new Error("This function can only be called in a browser environment.");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((doc as any)[ContextSymbol]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { bound: (doc as any)[ContextSymbol] as IBoundUseCases, subscription: undefined };
    }

    const store = new InMemoryThemeStore();
    const themeRepo = new ThemeRepository(store);
    const domRepo = new DOMAttrRepository(doc);

    const updateThemeUseCase = new UpdateThemeUseCase(themeRepo);
    const toggleDarkModeUseCase = new ToggleDarkModeUseCase(themeRepo);
    const loadFromStorageUseCase = new LoadThemeFromStorageUseCase(themeRepo);
    const saveToStorageUseCase = new SaveThemeToStorageUseCase(themeRepo);
    const syncAttrToDomUseCase = new SyncAttrToDomUseCase(themeRepo, domRepo);

    return bindUseCasesToDocument(doc, {
        themeRepo,
        domRepo,
        updateThemeUseCase,
        toggleDarkModeUseCase,
        loadFromStorageUseCase,
        saveToStorageUseCase,
        syncAttrToDomUseCase,
    });
}