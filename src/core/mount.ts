import { createStateStore } from './state-store';
import type { IContext } from './context';
import { SessionBrand } from './internals/branding';
import type { IState, ISession, IMountOptions } from './internals/session';

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
    return session;
}
