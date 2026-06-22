import type { IThemeRepository } from "../../domain/repositories/i-theme.repository";
import type { IDOMAttrRepository } from "../../domain/repositories/i-dom-attr.repository";

export class SyncAttrToDomUseCase {
    private readonly _themeRepo: IThemeRepository;
    private readonly _domRepo: IDOMAttrRepository;

    constructor(themeRepo: IThemeRepository, domRepo: IDOMAttrRepository) {
        this._themeRepo = themeRepo;
        this._domRepo = domRepo;
    }

    execute(): void {
        const state = this._themeRepo.getValue();
        this._domRepo.syncFromThemeState(state);
    }
}