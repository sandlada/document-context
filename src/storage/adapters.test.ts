import { describe, expect, it, beforeEach } from 'vitest'
import {
    createLocalStorageAdapter,
    createSessionStorageAdapter,
    getStorageAdapter,
    deserializeWithMigration,
    serializeWithVersion,
    getStorageInstance
} from './adapters'

describe('Storage Adapters & Version Migration', () => {
    beforeEach(() => {
        getStorageInstance('localStorage').clear()
        getStorageInstance('sessionStorage').clear()
    })

    it('wraps localStorage with get, set, remove operations', () => {
        const adapter = createLocalStorageAdapter()
        adapter.setItem('key1', JSON.stringify({ a: 1 }))

        expect(adapter.getItem('key1')).toBe('{"a":1}')
        expect(getStorageInstance('localStorage').getItem('key1')).toBe('{"a":1}')

        adapter.removeItem('key1')
        expect(adapter.getItem('key1')).toBeNull()
    })

    it('wraps sessionStorage with get, set, remove operations', () => {
        const adapter = createSessionStorageAdapter()
        adapter.setItem('skey', 'val')

        expect(adapter.getItem('skey')).toBe('val')
        expect(getStorageInstance('sessionStorage').getItem('skey')).toBe('val')

        adapter.removeItem('skey')
        expect(adapter.getItem('skey')).toBeNull()
    })

    it('resolves adapter by string name or custom adapter instance', () => {
        expect(getStorageAdapter('localStorage')).toBeDefined()
        expect(getStorageAdapter('sessionStorage')).toBeDefined()

        const custom = {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {}
        }
        expect(getStorageAdapter(custom)).toBe(custom)
    })

    it('serializes data with version envelope and migrates on deserialization', () => {
        const serialized = serializeWithVersion({ count: 5 }, 1)
        expect(JSON.parse(serialized)).toEqual({
            __v: 1,
            data: { count: 5 }
        })

        const migrated = deserializeWithMigration(
            serialized,
            2,
            (oldData: any, oldVersion: number) => {
                expect(oldVersion).toBe(1)
                return { count: oldData.count * 10, migrated: true }
            }
        )

        expect(migrated).toEqual({ count: 50, migrated: true })
    })
})
