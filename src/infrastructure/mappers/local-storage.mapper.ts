import type { IThemeRaw } from "../../domain/entities/theme.entity";
import { ThemeEntity } from "../../domain/entities/theme.entity";
import { ThemeMapper } from "./theme.mapper";

export class LocalStorageMapper {
    private readonly _themeMapper = new ThemeMapper();

    toEntity(jsonString: string): ThemeEntity {
        const parsed = JSON.parse(jsonString) as unknown;
        if (!ThemeEntity.isValid(parsed)) {
            throw new Error("Invalid theme config in local storage");
        }
        return this._themeMapper.toEntity(parsed);
    }

    toJsonString(entity: ThemeEntity): string {
        return JSON.stringify(this._themeMapper.toRaw(entity));
    }
}