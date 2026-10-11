/**
 * E2E: inject-before-mount order independence through the public entry.
 *
 * Runs in happy-dom with real elements and the real scope transport. The
 * consumer starts waiting before any provider exists; producers mount
 * afterwards and a later keyed mount's identity write-back wakes the pending
 * watch through the observer loop (a mount's own write races its responder
 * install, so the wake that settles a pre-mount wait arrives with the next
 * key change). Both the promise face and the resolve-once stream face must
 * settle with the late-provided value, proving call order never matters to
 * users.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
    createContext,
    dispose,
    inject,
    inject$,
    mount,
    pipe,
    provideSync,
} from '../index.js'

afterEach(() => {
    document.body.innerHTML = ''
})

const settle = async (rounds = 10): Promise<void> => {
    for (let index = 0; index < rounds; index += 1) {
        await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 0)
        })
    }
}

describe('inject before mount', () => {
    it('resolves a pending promise inject once a later keyed mount wakes the wait', async () => {
        const root = document.createElement('div')
        const leaf = document.createElement('span')
        root.appendChild(leaf)
        document.body.appendChild(root)
        const other = document.createElement('div')
        document.body.appendChild(other)
        try {
            const pending = inject('app:e2e-late')(leaf)
            const providerBlueprint = pipe(
                createContext({ count: 0 }),
                provideSync('app:e2e-late', () => 'late-value'),
            )
            const provider = await mount(providerBlueprint, { token: 'app:e2e-late-host' })(root)
            try {
                const unrelated = await mount(
                    pipe(createContext({ count: 0 })),
                    { token: 'app:e2e-unrelated' },
                )(other)
                try {
                    await settle()
                    await expect(pending).resolves.toBe('late-value')
                } finally {
                    dispose(unrelated)
                }
            } finally {
                dispose(provider)
            }
        } finally {
            root.remove()
            other.remove()
        }
    })

    it('emits a pending stream inject once a later keyed mount wakes the wait', async () => {
        const root = document.createElement('div')
        const leaf = document.createElement('span')
        root.appendChild(leaf)
        document.body.appendChild(root)
        const other = document.createElement('div')
        document.body.appendChild(other)
        try {
            const seen: Array<unknown> = []
            let completed = false
            const subscription = inject$('app:e2e-stream')(leaf).subscribe({
                next: (value) => {
                    seen.push(value)
                },
                complete: () => {
                    completed = true
                },
            })
            expect(seen).toEqual([])
            const providerBlueprint = pipe(
                createContext({ count: 0 }),
                provideSync('app:e2e-stream', () => ({ ready: true })),
            )
            const provider = await mount(providerBlueprint, { token: 'app:e2e-stream-host' })(root)
            try {
                const unrelated = await mount(
                    pipe(createContext({ count: 0 })),
                    { token: 'app:e2e-stream-other' },
                )(other)
                try {
                    await settle()
                    expect(seen).toEqual([{ ready: true }])
                    expect(completed).toBe(true)
                } finally {
                    subscription.unsubscribe()
                    dispose(unrelated)
                }
            } finally {
                dispose(provider)
            }
        } finally {
            root.remove()
            other.remove()
        }
    })

    it('resolves a fresh inject from a lazily connected descendant after the provider mounts', async () => {
        const root = document.createElement('div')
        document.body.appendChild(root)
        try {
            const providerBlueprint = pipe(
                createContext({ count: 0 }),
                provideSync('app:e2e-lazy-leaf', () => 'lazy-value'),
            )
            const session = await mount(providerBlueprint)(root)
            try {
                const leaf = document.createElement('span')
                root.appendChild(leaf)
                await expect(inject('app:e2e-lazy-leaf')(leaf)).resolves.toBe('lazy-value')
            } finally {
                dispose(session)
            }
        } finally {
            root.remove()
        }
    })
})
