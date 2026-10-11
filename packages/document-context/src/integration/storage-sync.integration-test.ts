/**
 * Integration: persistence hydration plus cross-tab observation through the
 * assembled application and the deterministic domain fakes.
 *
 * Runs in happy-dom. The hydration half mounts through the default wired
 * entry with `persist` over a fake backend: a pre-seeded version envelope
 * hydrates the session, a corrupt payload falls back to the seed while
 * buffering `INVALID_STORAGE_DATA`, and one backend serves two mounts. The
 * observe half reuses the same fake: self-writes stay silent while
 * `emitExternal` (the cross-tab stand-in) notifies `observe$` subscribers.
 *
 * State-to-backend write-back on `update` is intentionally not asserted: it
 * is deferred in v0.1.0 (the domain and application docs reserve
 * microtask-batched write-backs and cross-tab conflict resolution), so this
 * suite pins the shipped hydration and observation behavior only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
    createContext,
    dispose,
    mount,
    persist,
    pipe,
    selectSync,
    update,
} from '../index.js'
import { createFakeStorage } from '../domain/testing/fakes.js'

afterEach(() => {
    document.body.innerHTML = ''
})

const mountElement = (): HTMLDivElement => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    return element
}

describe('persist hydration', () => {
    it('hydrates a fresh mount from a pre-seeded envelope and reuses one backend across mounts', async () => {
        const backend = createFakeStorage()
        await backend.port.write('app:sync-seed', JSON.stringify({ v: 0, d: { count: 12 } }))
        const first = mountElement()
        try {
            const blueprint = pipe(
                createContext({ count: 0 }),
                persist({ storage: backend.port, key: 'app:sync-seed' }),
            )
            const session = await mount(blueprint)(first)
            try {
                expect(selectSync((state: { count: number }) => state.count)(session)).toBe(12)
                update({ count: 13 })(session)
                expect(selectSync((state: { count: number }) => state.count)(session)).toBe(13)
            } finally {
                dispose(session)
            }
        } finally {
            first.remove()
        }

        const second = mountElement()
        try {
            const blueprint = pipe(
                createContext({ count: 0 }),
                persist({ storage: backend.port, key: 'app:sync-seed' }),
            )
            const revived = await mount(blueprint)(second)
            try {
                expect(selectSync((state: { count: number }) => state.count)(revived)).toBe(12)
            } finally {
                dispose(revived)
            }
        } finally {
            second.remove()
        }
    })

    it('falls back to the seed and buffers INVALID_STORAGE_DATA on corrupt payloads', async () => {
        const backend = createFakeStorage()
        await backend.port.write('app:sync-corrupt', 'not-json{{{')
        const element = mountElement()
        try {
            const blueprint = pipe(
                createContext({ count: 3 }),
                persist({ storage: backend.port, key: 'app:sync-corrupt' }),
            )
            const session = await mount(blueprint)(element)
            try {
                expect(selectSync((state: { count: number }) => state.count)(session)).toBe(3)
                const codes: Array<string> = []
                session.errors$.subscribe((error) => {
                    codes.push(error.code)
                })
                expect(codes).toEqual(['INVALID_STORAGE_DATA'])
            } finally {
                dispose(session)
            }
        } finally {
            element.remove()
        }
    })
})

describe('cross-tab observe', () => {
    it('keeps self-writes silent while external writes notify observers', async () => {
        const handle = createFakeStorage()
        const seen: Array<string | null> = []
        const subscription = handle.port.observe$('app:sync-key').subscribe((value) => {
            seen.push(value)
        })
        try {
            expect(await handle.port.write('app:sync-key', '{"v":0,"d":{"count":1}}')).toEqual({
                ok: true,
                value: undefined,
            })
            expect(seen).toEqual([])

            handle.emitExternal('app:sync-key', '{"v":0,"d":{"count":9}}')
            expect(seen).toEqual(['{"v":0,"d":{"count":9}}'])

            handle.emitExternal('app:sync-key', null)
            expect(seen).toEqual(['{"v":0,"d":{"count":9}}', null])
        } finally {
            subscription.unsubscribe()
        }
    })

    it('hydrates a mounted session from a pre-seeded fake backend', async () => {
        const handle = createFakeStorage()
        await handle.port.write('app:shared-counter', JSON.stringify({ v: 0, d: { count: 21 } }))
        const element = mountElement()
        try {
            const blueprint = pipe(
                createContext({ count: 0 }),
                persist({ storage: handle.port, key: 'app:shared-counter' }),
            )
            const session = await mount(blueprint)(element)
            try {
                expect(selectSync((state: { count: number }) => state.count)(session)).toBe(21)
            } finally {
                dispose(session)
            }
        } finally {
            element.remove()
        }
    })
})
