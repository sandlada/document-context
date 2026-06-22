import type { IThemeRaw } from "../../domain/entities/theme.entity";
import type { IThemeRepository } from "../../domain/repositories/i-theme.repository";

export class UpdateThemeUseCase {
    private readonly _themeRepo: IThemeRepository;

    constructor(themeRepo: IThemeRepository) {
        this._themeRepo = themeRepo;
    }

    execute(partial: Partial<IThemeRaw>): void {
        this._themeRepo.update(partial);
    }
}