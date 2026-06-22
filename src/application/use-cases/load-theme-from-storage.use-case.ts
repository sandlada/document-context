import type { IThemeRepository } from "../../domain/repositories/i-theme.repository";
import { LocalStorageThemeStore } from "../../infrastructure/stores/local-storage-theme.store";
import { LocalStorageMapper } from "../../infrastructure/mappers/local-storage.mapper";

export class LoadThemeFromStorageUseCase {
    private readonly _themeRepo: IThemeRepository;

    constructor(themeRepo: IThemeRepository) {
        this._themeRepo = themeRepo;
    }

    execute(key?: string): void {
        const store = new LocalStorageThemeStore(key);
        const raw = store.load();
        if (!raw) throw new Error("No theme config found in local storage with key: " + store.getKey());
        const mapper = new LocalStorageMapper();
        const entity = mapper.toEntity(raw);
        this._themeRepo.replace(entity);
    }
}