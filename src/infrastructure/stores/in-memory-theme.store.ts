import { BehaviorSubject, type Observable } from "rxjs";
import type { IThemeRaw } from "../../domain/entities/theme.entity";
import { ThemeEntity } from "../../domain/entities/theme.entity";

export class InMemoryThemeStore {
    private readonly _subject: BehaviorSubject<ThemeEntity>;

    public readonly state$: Observable<ThemeEntity>;

    constructor(initial: ThemeEntity = new ThemeEntity()) {
        this._subject = new BehaviorSubject<ThemeEntity>(initial);
        this.state$ = this._subject.asObservable();
    }

    getValue(): ThemeEntity {
        return this._subject.getValue();
    }

    update(partial: Partial<IThemeRaw>): void {
        const current = this._subject.getValue();
        this._subject.next(current.with(partial));
    }

    replace(entity: ThemeEntity): void {
        this._subject.next(entity);
    }
}