import type { BehaviorSubject } from 'rxjs';
import { SessionBrand } from './branding';

export interface IState extends Record<PropertyKey, unknown> {}

export interface IMountOptions<S extends IState> {
    readonly scope?: any;
    readonly sync?: IBridgeOptions<S>;
    readonly lenient?: boolean;
}

export interface IBridgeOptions<S extends IState> {
    readonly target: object;
    readonly properties:
        | { readonly [K in keyof S]?: string }
        | { readonly selectAll: true };
    readonly events?: readonly string[];
    readonly batch?: boolean;
    readonly conflict?: 'lastWriteWins' | 'statePrecedence' | 'domPrecedence';
    readonly ignoreInternalWrite?: boolean;
    readonly deepFreeze?: boolean;
}

export interface IStateStore<S extends IState> {
    readonly state$: BehaviorSubject<Readonly<S>>;
    getValue(): Readonly<S>;
    update(partial: Partial<S>): Readonly<S>;
    replace(next: S): Readonly<S>;
}

export interface ISession<S extends IState> {
    readonly [SessionBrand]: true;
    readonly target: object;
    readonly schemas: S;
    readonly options: Readonly<IMountOptions<S>>;
    readonly store: IStateStore<S>;
}
