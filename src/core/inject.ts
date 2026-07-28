import { CircularDependencyError, UnknownServiceError } from '../errors';
import type { ISession, IState } from './internals/session';
import type { IScopeToken } from './scope';
import { REGISTRY, SINGLETON_CACHE, SESSIONS } from './provide';

const CALL_STACK: WeakMap<ISession<any>, Set<unknown>> = new WeakMap();
const SCOPED_CACHE: WeakMap<ISession<any>, Map<unknown, unknown>> = new WeakMap();

function findSessionWithToken(start: ISession<any>, key: unknown): ISession<any> | undefined {
    const seen = new Set<object>();
    let cur: ISession<any> | undefined = start;
    while (cur) {
        if (seen.has(cur as any)) break;
        seen.add(cur as any);
        const m = REGISTRY.get(cur);
        if (m?.has(key)) return cur;
        cur = (cur.options.scope as any)?.parent ?? undefined;
    }
    return undefined;
}

function findProviderGlobal(key: unknown): ISession<any> | undefined {
    for (const s of SESSIONS) {
        const m = REGISTRY.get(s);
        if (m?.has(key)) return s;
    }
    return undefined;
}

function scopedCacheFor(session: ISession<any>): Map<unknown, unknown> {
    let cache = SCOPED_CACHE.get(session);
    if (!cache) {
        cache = new Map();
        SCOPED_CACHE.set(session, cache);
    }
    return cache;
}

export function inject<T, S extends IState>(session: ISession<S>, token: IScopeToken<T> | string): T {
    let owner = findSessionWithToken(session, token);
    if (!owner) owner = findProviderGlobal(token);
    if (!owner) throw new UnknownServiceError(`Unknown service token: ${String(token)}`);

    let stack = CALL_STACK.get(session);
    if (!stack) {
        stack = new Set();
        CALL_STACK.set(session, stack);
    }
    if (stack.has(token)) {
        throw new CircularDependencyError(Array.from(stack as any) as unknown as string[]);
    }
    const map = REGISTRY.get(owner);
    if (!map) throw new UnknownServiceError(`Unknown service token: ${String(token)}`);

    const entry = map.get(token);
    if (!entry) throw new UnknownServiceError(`Unknown service token: ${String(token)}`);
    stack.add(token);
    try {
        switch (entry.lifecycle) {
            case 'singleton': {
                if (!SINGLETON_CACHE.has(token)) {
                    SINGLETON_CACHE.set(token, entry.factory());
                }
                return SINGLETON_CACHE.get(token) as T;
            }
            case 'transient':
                return entry.factory() as T;
            case 'scoped': {
                const cache = scopedCacheFor(session);
                if (!cache.has(token)) {
                    cache.set(token, entry.factory());
                }
                return cache.get(token) as T;
            }
        }
    } finally {
        stack.delete(token);
    }
}
