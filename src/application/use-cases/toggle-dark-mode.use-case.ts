import type { IThemeRepository } from "../../domain/repositories/i-theme.repository";

export class ToggleDarkModeUseCase {
    private readonly _themeRepo: IThemeRepository;

    constructor(themeRepo: IThemeRepository) {
        this._themeRepo = themeRepo;
    }

    execute(): void {
        const current = this._themeRepo.getValue();
        this._themeRepo.update({ isDark: !current.isDark });
    }
}