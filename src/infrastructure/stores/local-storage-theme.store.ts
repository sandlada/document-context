import type { IThemeRaw, ThemeEntity } from "../../domain/entities/theme.entity";

export class LocalStorageThemeStore {
    private readonly _key: string;

    constructor(key = "theme-config") {
        this._key = key;
    }

    getKey(): string {
        return this._key;
    }

    load(): string | null {
        return localStorage.getItem(this._key);
    }

    save(raw: IThemeRaw): void {
        localStorage.setItem(this._key, JSON.stringify(raw));
    }
}