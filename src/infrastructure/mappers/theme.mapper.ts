import type { IThemeRaw } from "../../domain/entities/theme.entity";
import { ThemeEntity } from "../../domain/entities/theme.entity";

export class ThemeMapper {
    toEntity(raw: IThemeRaw): ThemeEntity {
        return new ThemeEntity(raw);
    }

    toRaw(entity: ThemeEntity): IThemeRaw {
        return entity.toRaw();
    }
}