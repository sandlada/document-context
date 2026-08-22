import type { IAsyncStorageAdapter, IStorageAdapter } from '../core/types'

class MemoryStorage implements Storage {
    private data = new Map<string, string>()

    get length(): number {
        return this.data.size
    }

    clear(): void {
        this.data.clear()
    }

    getItem(key: string): string | null {
        return this.data.get(key) ?? null
    }

    key(index: number): string | null {
        return Array.from(this.data.keys())[index] ?? null
    }

    removeItem(key: string): void {
        this.data.delete(key)
    }

    setItem(key: string, value: string): void {
        this.data.set(key, String(value))
    }
}

const memoryStorageFallback = new Map<string, Storage>()

export function getStorageInstance(type: 'localStorage' | 'sessionStorage'): Storage {
    try {
        if (typeof window !== 'undefined' && window[type]) {
            const st = window[type]
            st.setItem('__test_probe__', '1')
            st.removeItem('__test_probe__')
            return st
        }
    } catch {
        // In Node 22, global localStorage throws if --localstorage-file is not passed
    }

    try {
        if (typeof globalThis !== 'undefined' && (globalThis as any)[type]) {
            const st = (globalThis as any)[type]
            st.setItem('__test_probe__', '1')
            st.removeItem('__test_probe__')
            return st
        }
    } catch {
        // Fallback
    }

    if (!memoryStorageFallback.has(type)) {
        memoryStorageFallback.set(type, new MemoryStorage())
    }
    return memoryStorageFallback.get(type)!
}

export function createLocalStorageAdapter(): IStorageAdapter {
    return {
        getItem(key: string) {
            const storage = getStorageInstance('localStorage')
            return storage.getItem(key)
        },
        setItem(key: string, value: string) {
            const storage = getStorageInstance('localStorage')
            storage.setItem(key, String(value))
        },
        removeItem(key: string) {
            const storage = getStorageInstance('localStorage')
            storage.removeItem(key)
        }
    }
}

export function createSessionStorageAdapter(): IStorageAdapter {
    return {
        getItem(key: string) {
            const storage = getStorageInstance('sessionStorage')
            return storage.getItem(key)
        },
        setItem(key: string, value: string) {
            const storage = getStorageInstance('sessionStorage')
            storage.setItem(key, String(value))
        },
        removeItem(key: string) {
            const storage = getStorageInstance('sessionStorage')
            storage.removeItem(key)
        }
    }
}

export function getStorageAdapter(
    adapter: 'localStorage' | 'sessionStorage' | IStorageAdapter<any> | IAsyncStorageAdapter<any>
): IStorageAdapter<any> | IAsyncStorageAdapter<any> {
    if (adapter === 'localStorage') {
        return createLocalStorageAdapter()
    }
    if (adapter === 'sessionStorage') {
        return createSessionStorageAdapter()
    }
    return adapter
}

export function serializeWithVersion(data: any, version = 1): string {
    return JSON.stringify({
        __v: version,
        data
    })
}

export function deserializeWithMigration(
    raw: string | null,
    targetVersion = 1,
    migrate?: (oldData: any, oldVersion: number) => any
): any {
    if (raw === null || raw === undefined) {
        return null
    }

    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && '__v' in parsed && 'data' in parsed) {
        const currentV = Number(parsed.__v) || 0
        if (currentV < targetVersion && typeof migrate === 'function') {
            return migrate(parsed.data, currentV)
        }
        return parsed.data
    }

    return parsed
}
