export interface IStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const localStorageAdapter: IStorageLike = {
    getItem: (k) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(k)),
    setItem: (k, v) => {
        if (typeof localStorage === 'undefined') throw new Error('localStorage is not available');
        localStorage.setItem(k, v);
    },
};

export function getStorageAdapter(name: 'localStorage'): IStorageLike {
    if (name !== 'localStorage') throw new Error('Unknown adapter: ' + name);
    return localStorageAdapter;
}
