import type { ISession, IState } from './internals/session';
import type { IScopeToken } from './scope';

export interface IServiceOptions {
    lifecycle?: 'singleton' | 'transient' | 'scoped';
}

export interface IRegistryEntry {
    factory: () => unknown;
    lifecycle: 'singleton' | 'transient' | 'scoped';
}

export const REGISTRY: WeakMap<ISession<any>, Map<unknown, IRegistryEntry>> = new WeakMap();
export const SINGLETON_CACHE: Map<unknown, unknown> = new Map();
export const SESSIONS: Set<ISession<any>> = new Set();

function resolveKey(token: unknown): unknown {
    return token;
}

export function provide<T, S extends IState>(
    session: ISession<S>,
    token: IScopeToken<T> | string,
    factory: () => T,
    options: IServiceOptions = {},
): void {
    const lifecycle = options.lifecycle ?? 'singleton';
    let map = REGISTRY.get(session);
    if (!map) {
        map = new Map();
        REGISTRY.set(session, map);
    }
    map.set(resolveKey(token), { factory, lifecycle });
    SESSIONS.add(session);
}
