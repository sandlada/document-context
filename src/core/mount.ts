import { bridgeState } from './bridge';
import { createStateStore } from './state-store';
import type { IContext } from './context';
import { SessionBrand } from './internals/branding';
import type { IState, ISession, IMountOptions } from './internals/session';
import { watchRemoval } from '../adapters/dom-mutation';
import { dispose } from './dispose';

export const BRIDGE_REGISTRY: WeakMap<ISession<any>, Set<() => void>> = new WeakMap();

export function registerBridgeDisposer<S extends IState>(session: ISession<S>, disposer: () => void): void {
    let set = BRIDGE_REGISTRY.get(session);
    if (!set) { set = new Set(); BRIDGE_REGISTRY.set(session, set); }
    set.add(disposer);
}

// Symbol-keyed cache to guarantee idempotency per target.
const TARGET_CACHE: WeakMap<object, ISession<any>[]> = new WeakMap();

function attachSession<S extends IState>(target: object, session: ISession<S>): void {
    const list = TARGET_CACHE.get(target);
    if (list) list.push(session);
    else TARGET_CACHE.set(target, [session]);
}

export function mount<S extends IState>(
    target: object,
    ctx: IContext<S>,
    options: IMountOptions<S> = {},
): ISession<S> {
    if (!ctx || typeof ctx !== 'object' || ctx.schema === undefined) {
        throw new Error('mount: invalid context. Did you call createContext()?');
    }
    const list = TARGET_CACHE.get(target);
    if (list) {
        for (const s of list as ISession<S>[]) {
            if (s.target === target && s.schemas === ctx.schema) return s;
        }
    }
    const store = createStateStore(ctx.schema);
    const session: ISession<S> = {
        [SessionBrand]: true,
        target,
        schemas: ctx.schema,
        options,
        store,
    };
    attachSession(target, session);
    if (options.sync) {
        const syncDispose = bridgeState(session, options.sync);
        registerBridgeDisposer(session, syncDispose);
    }
    if (typeof Node !== 'undefined' && target instanceof Node) {
        watchRemoval(target, () => dispose(session));
    }
    return session;
}
