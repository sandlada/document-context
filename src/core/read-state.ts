import type { ISession, IState } from './internals/session';

export function readState<S extends IState>(session: ISession<S>): Readonly<S> {
    return session.store.getValue();
}
