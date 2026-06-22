import type { Observable } from "rxjs";
import type { IThemeRaw, ThemeEntity } from "../entities/theme.entity";

export interface IThemeRepository {
    readonly state$: Observable<ThemeEntity>;

    getValue(): ThemeEntity;

    update(partial: Partial<IThemeRaw>): void;

    replace(entity: ThemeEntity): void;
}