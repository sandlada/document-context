import { getStorageAdapter } from '../adapters/local-storage';
import { InvalidStoredStateError } from '../errors';
import { sessionReplace } from './internals/state-mutations';
import type { ISession, IState } from './internals/session';

export function loadState<S extends IState>(
    session: ISession<S>,
    opts: { adapter: 'localStorage'; key: string },
): void {
    const adapter = getStorageAdapter(opts.adapter);
    const raw = adapter.getItem(opts.key);
    if (raw === null) return;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') throw new InvalidStoredStateError('not object');
        sessionReplace(session as any, parsed as S);
    } catch (e) {
        if (e instanceof InvalidStoredStateError) return;
        // Keep silent for corrupt JSON: keep current state (spec requirement).
    }
}
