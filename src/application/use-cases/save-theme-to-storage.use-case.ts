import type { IThemeRepository } from "../../domain/repositories/i-theme.repository";
import { LocalStorageThemeStore } from "../../infrastructure/stores/local-storage-theme.store";
import { ThemeMapper } from "../../infrastructure/mappers/theme.mapper";

export class SaveThemeToStorageUseCase {
    private readonly _themeRepo: IThemeRepository;

    constructor(themeRepo: IThemeRepository) {
        this._themeRepo = themeRepo;
    }

    execute(key?: string): void {
        const current = this._themeRepo.getValue();
        const store = new LocalStorageThemeStore(key);
        const mapper = new ThemeMapper();
        store.save(mapper.toRaw(current));
    }
}
