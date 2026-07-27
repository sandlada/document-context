import type { Subscription } from 'rxjs';
import type { ISession, IState } from './internals/session';

export function subscribeState<S extends IState>(
    session: ISession<S>,
    fn: (state: Readonly<S>) => void,
): () => void {
    const sub: Subscription = session.store.state$.subscribe((s) => fn(s as Readonly<S>));
    return () => sub.unsubscribe();
}
