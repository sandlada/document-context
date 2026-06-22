import type { Observable } from "rxjs";
import type { IThemeRaw, ThemeEntity } from "../../domain/entities/theme.entity";
import type { IThemeRepository } from "../../domain/repositories/i-theme.repository";
import { InMemoryThemeStore } from "../stores/in-memory-theme.store";

export class ThemeRepository implements IThemeRepository {
    public readonly state$: Observable<ThemeEntity>;

    private readonly _store: InMemoryThemeStore;

    constructor(store?: InMemoryThemeStore) {
        this._store = store ?? new InMemoryThemeStore();
        this.state$ = this._store.state$;
    }

    getValue(): ThemeEntity {
        return this._store.getValue();
    }

    update(partial: Partial<IThemeRaw>): void {
        this._store.update(partial);
    }

    replace(entity: ThemeEntity): void {
        this._store.replace(entity);
    }
}