import type { ISession, IState } from './session';

export function sessionReplace<S extends IState>(session: ISession<S>, next: S): void {
    session.store.replace(next);
}
