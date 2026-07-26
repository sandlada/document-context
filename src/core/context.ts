import type { IState } from './internals/session';

export interface IContext<S extends IState> {
    readonly schema: S;
    readonly seed?: never;
}

export function createContext<S extends IState>(initial: S): IContext<S> {
    return { schema: initial };
}
