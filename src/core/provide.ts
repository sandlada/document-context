import { UnknownServiceError } from '../errors';
import { CALL_STACK } from './inject';
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
    const key = resolveKey(token);
    map.set(key, { factory, lifecycle });
    SESSIONS.add(session);

    // Eager cycle detection — invoke factory once so any recursive inject() call
    // exercises the per-session call stack. The result is discarded; the factory
    // remains stored and will be invoked again on first inject() to actually
    // construct the instance per its lifecycle. UnknownServiceError is tolerated
    // here because forward references may not have been registered yet. On any
    // other error (notably CircularDependencyError) the registry entry we just
    // inserted is rolled back so subsequent inject() calls don't see a failed
    // provider.
    let stack = CALL_STACK.get(session);
    if (!stack) { stack = new Set(); CALL_STACK.set(session, stack); }
    stack.add(token);
    try {
        factory();
    } catch (e) {
        if (e instanceof UnknownServiceError) {
            // tolerate: deps may not be registered yet
        } else {
            map.delete(key);
            stack.delete(token);
            throw e;
        }
    }
    stack.delete(token);
}
