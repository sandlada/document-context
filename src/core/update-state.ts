import type { ISession, IState } from './internals/session';

export function updateState<S extends IState>(
    session: ISession<S>,
    partial: Partial<S>,
): Readonly<S> {
    return session.store.update(partial);
}
