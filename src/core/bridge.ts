import { InternalWriteSymbol } from './internals/branding';
import { readPropertyPath, writePropertyPath } from './internals/property-path';
import type { IBridgeOptions, ISession, IState } from './internals/session';

export function bridgeState<S extends IState>(
    session: ISession<S>,
    options: IBridgeOptions<S>,
): () => void {
    const target = options.target;
    const eventTarget = target as EventTarget;
    const events = options.events ?? ['input', 'change'];
    const batch = options.batch ?? true;
    const ignoreInternal = options.ignoreInternalWrite ?? true;
    const propertyEntries: Array<{ key: keyof S & string; path: string }> =
        'selectAll' in options.properties
            ? (Object.keys(session.schemas) as Array<keyof S & string>).map((key) => ({ key, path: key }))
            : (Object.entries(options.properties) as Array<[keyof S & string, string | undefined]>)
                  .filter(([, path]): path is string => typeof path === 'string')
                  .map(([key, path]) => ({ key, path }));

    let pendingMicrotask = false;
    let disposed = false;

    const flush = () => {
        pendingMicrotask = false;
        if (disposed) return;
        const state = session.store.getValue();
        for (const { key, path } of propertyEntries) {
            const expected = state[key];
            if (readPropertyPath(target, path) === expected) continue;
            if (ignoreInternal) (target as any)[InternalWriteSymbol] = true;
            try {
                writePropertyPath(target, path, expected);
            } finally {
                if (ignoreInternal) delete (target as any)[InternalWriteSymbol];
            }
        }
    };

    const subscription = session.store.state$.subscribe(() => {
        if (!batch) {
            flush();
            return;
        }
        if (!pendingMicrotask) {
            pendingMicrotask = true;
            queueMicrotask(flush);
        }
    });

    const onEvent = () => {
        if (ignoreInternal && (target as any)[InternalWriteSymbol]) return;
        const state = session.store.getValue();
        const partial: Partial<S> = {};
        let changed = false;
        for (const { key, path } of propertyEntries) {
            const value = readPropertyPath(target, path);
            if (value !== state[key]) {
                (partial as any)[key] = value;
                changed = true;
            }
        }
        if (changed) session.store.update(partial);
    };

    for (const event of events) eventTarget.addEventListener(event, onEvent);

    flush();

    return () => {
        disposed = true;
        subscription.unsubscribe();
        for (const event of events) eventTarget.removeEventListener(event, onEvent);
    };
}
