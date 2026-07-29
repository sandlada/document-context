import { getStorageAdapter } from '../adapters/local-storage';
import { readState } from './read-state';
import type { ISession, IState } from './internals/session';

export function saveState<S extends IState>(
    session: ISession<S>,
    opts: { adapter: 'localStorage'; key: string },
): void {
    const state = readState(session) as any;
    const adapter = getStorageAdapter(opts.adapter);
    adapter.setItem(opts.key, JSON.stringify(state));
}
