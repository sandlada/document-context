import { BehaviorSubject } from 'rxjs';
import type { IState, IStateStore } from './internals/session';

const shallowFreeze = <S extends IState>(state: S): Readonly<S> => Object.freeze({ ...state });

export function createStateStore<S extends IState>(
    initial: S,
    opts: { deepFreeze?: boolean } = {},
): IStateStore<S> {
    const subject = new BehaviorSubject<Readonly<S>>(shallowFreeze(initial));
    const deep = opts.deepFreeze === true;
    const freeze = (state: S): Readonly<S> =>
        (deep ? deepFreezeImpl(state) : shallowFreeze(state)) as Readonly<S>;
    return {
        state$: subject,
        getValue: () => subject.getValue(),
        update: (partial) => {
            const next = freeze({ ...subject.getValue(), ...partial });
            subject.next(next);
            return next;
        },
        replace: (next) => {
            const v = freeze(next);
            subject.next(v);
            return v;
        },
    };
}

function deepFreezeImpl<T>(value: T): Readonly<T> {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const k of Object.keys(value as any)) {
            (value as any)[k] = deepFreezeImpl((value as any)[k]);
        }
        Object.freeze(value);
    }
    return value;
}
