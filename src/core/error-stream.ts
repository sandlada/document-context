import { Subject, type Observable } from 'rxjs';
import type { LibraryError } from '../errors';
import type { ISession, IState } from './internals/session';

const STREAMS: WeakMap<ISession<any>, Subject<LibraryError>> = new WeakMap();

export function readErrorStream<S extends IState>(session: ISession<S>): Observable<LibraryError> {
    let subj = STREAMS.get(session);
    if (!subj) {
        subj = new Subject<LibraryError>();
        STREAMS.set(session, subj);
    }
    return subj.asObservable();
}

export function reportError(session: ISession<any>, err: LibraryError): void {
    const subj = STREAMS.get(session);
    if (subj) subj.next(err);
}
