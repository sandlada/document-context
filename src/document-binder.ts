import type { Observable, Subscription } from "rxjs";
import type { IThemeRaw } from "./domain/entities/theme.entity";
import { ThemeEntity } from "./domain/entities/theme.entity";
import type { IThemeRepository } from "./domain/repositories/i-theme.repository";
import type { IDOMAttrRepository } from "./domain/repositories/i-dom-attr.repository";
import type { UpdateThemeUseCase } from "./application/use-cases/update-theme.use-case";
import type { ToggleDarkModeUseCase } from "./application/use-cases/toggle-dark-mode.use-case";
import type { LoadThemeFromStorageUseCase } from "./application/use-cases/load-theme-from-storage.use-case";
import type { SaveThemeToStorageUseCase } from "./application/use-cases/save-theme-to-storage.use-case";
import type { SyncAttrToDomUseCase } from "./application/use-cases/sync-attr-to-dom.use-case";

export const ContextSymbol = Symbol("DocumentContext");

export interface IBoundUseCases {
    readonly theme$: Observable<ThemeEntity>;
    getThemeConfig: () => ThemeEntity;

    updateThemeConfig: (partial: Partial<IThemeRaw>) => void;
    toggleIsDark: () => void;

    loadThemeConfig: (key?: string) => void;
    saveThemeConfig: (key?: string) => void;

    syncThemeAttr: () => void;

    isThemeConfig: (obj: unknown) => obj is IThemeRaw;
}

export interface IBinderDeps {
    themeRepo: IThemeRepository;
    domRepo: IDOMAttrRepository;
    updateThemeUseCase: UpdateThemeUseCase;
    toggleDarkModeUseCase: ToggleDarkModeUseCase;
    loadFromStorageUseCase: LoadThemeFromStorageUseCase;
    saveToStorageUseCase: SaveThemeToStorageUseCase;
    syncAttrToDomUseCase: SyncAttrToDomUseCase;
}

export interface IBinderResult {
    readonly bound: IBoundUseCases;
    readonly subscription: Subscription;
}

/**
 * 将用例绑定到 document[ContextSymbol] 并提供自动 DOM 属性同步
 */
export function bindUseCasesToDocument(
    document: Document,
    deps: IBinderDeps
): IBinderResult {
    const sub = deps.themeRepo.state$.subscribe((state) => {
        deps.domRepo.syncFromThemeState(state);
    });

    const bound: IBoundUseCases = {
        theme$: deps.themeRepo.state$,
        getThemeConfig: () => deps.themeRepo.getValue(),

        updateThemeConfig: (partial) => deps.updateThemeUseCase.execute(partial),
        toggleIsDark: () => deps.toggleDarkModeUseCase.execute(),

        loadThemeConfig: (key) => deps.loadFromStorageUseCase.execute(key),
        saveThemeConfig: (key) => deps.saveToStorageUseCase.execute(key),

        syncThemeAttr: () => deps.syncAttrToDomUseCase.execute(),

        isThemeConfig: ThemeEntity.isValid,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document as any)[ContextSymbol] = bound;

    return { bound, subscription: sub };
}