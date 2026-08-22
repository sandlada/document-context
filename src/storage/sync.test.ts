import { describe, expect, it, beforeEach } from 'vitest'
import { createContext } from '../core/context'
import { mount } from '../core/mount'
import { pipe } from '../core/pipe'
import { select } from '../core/select'
import { readErrorStream } from '../core/dispose'
import { InvalidStorageDataError } from '../core/errors'
import { withStorage } from './with-storage'
import { getStorageInstance } from './adapters'

describe('Storage Fault Tolerance & Cross-Tab Sync', () => {
    beforeEach(() => {
        getStorageInstance('localStorage').clear()
    })

    it('safely handles corrupted JSON in storage and emits InvalidStorageDataError to error stream', () => {
        getStorageInstance('localStorage').setItem('corrupted-app', '{ invalid json syntax')

        const el = document.createElement('div')
        const bp = pipe(
            createContext({ count: 123 }),
            withStorage({
                adapter: 'localStorage',
                key: 'corrupted-app'
            })
        )

        const session = mount(bp)(el)
        const errors: any[] = []
        readErrorStream(session).subscribe((err) => errors.push(err))

        // Initial state falls back safely to blueprint initial state
        expect(select((s: { count: number }) => s.count)(session)).toBe(123)
        expect(errors.length).toBe(1)
        expect(errors[0]).toBeInstanceOf(InvalidStorageDataError)
    })

    it('synchronizes state when a cross-tab StorageEvent fires on window', () => {
        const el = document.createElement('div')
        const bp = pipe(
            createContext({ count: 0 }),
            withStorage({
                adapter: 'localStorage',
                key: 'sync-counter',
                crossTabSync: true
            })
        )

        const session = mount(bp)(el)
        expect(select((s: { count: number }) => s.count)(session)).toBe(0)

        // Simulate cross-tab storage event
        const storageEvent = new StorageEvent('storage', {
            key: 'sync-counter',
            newValue: JSON.stringify({ __v: 1, data: { count: 77 } })
        })
        window.dispatchEvent(storageEvent)

        expect(select((s: { count: number }) => s.count)(session)).toBe(77)
    })
})
