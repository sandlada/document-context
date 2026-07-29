import type { ISession, IState } from './internals/session';
import { BRIDGE_REGISTRY } from './mount';

export function dispose<S extends IState>(session: ISession<S>): void {
    const disposers = BRIDGE_REGISTRY.get(session);
    if (disposers) {
        for (const d of disposers) d();
        BRIDGE_REGISTRY.delete(session);
    }
    Object.defineProperty(session, 'store', { get() { throw new Error('Session was disposed.'); }, configurable: true });
}
