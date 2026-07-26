import { ScopeBrand } from './internals/branding';

export interface IScopeToken<T> {
    readonly [ScopeBrand]: true;
    readonly name: string;
    readonly __type?: T;
}

export function defineScope<T = unknown>(name: string): IScopeToken<T> {
    return { [ScopeBrand]: true, name } as IScopeToken<T>;
}