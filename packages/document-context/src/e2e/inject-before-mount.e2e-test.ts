/**
 * E2E: inject-before-mount order independence through the public entry.
 *
 * Runs in happy-dom with real elements and the real scope transport. The
 * consumer starts waiting before any provider exists; the provider mount
 * itself wakes the pending watch through the `context-mount` announcement
 * (09b §9b.4 first row), with no further key change required. Both the
 * promise face and the resolve-once stream face must settle with the
 * late-provided value, proving call order never matters to users.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
    createContext,
    dispose,
    inject,
    inject$,
    injectAll,
    mount,
    mountSync,
    pipe,
    provide,
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
    it('resolves a pending promise inject on its own mount with no further key change', async () => {
        const root = document.createElement('div')
        const leaf = document.createElement('span')
        root.appendChild(leaf)
        document.body.appendChild(root)
        try {
            const pending = inject('app:e2e-late')(leaf)
            const providerBlueprint = pipe(
                createContext({ count: 0 }),
                provideSync('app:e2e-late', () => 'late-value'),
            )
            const provider = await mount(providerBlueprint, { token: 'app:e2e-late-host' })(root)
            try {
                await settle()
                await expect(pending).resolves.toBe('late-value')
            } finally {
                dispose(provider)
            }
        } finally {
            root.remove()
        }
    })

    it('emits a pending stream inject on its own mount with no further key change', async () => {
        const root = document.createElement('div')
        const leaf = document.createElement('span')
        root.appendChild(leaf)
        document.body.appendChild(root)
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
                await settle()
                expect(seen).toEqual([{ ready: true }])
                expect(completed).toBe(true)
            } finally {
                subscription.unsubscribe()
                dispose(provider)
            }
        } finally {
            root.remove()
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

    it('settles a pending inject after async eager hydration with no further key change', async () => {
        const root = document.createElement('div')
        const leaf = document.createElement('span')
        root.appendChild(leaf)
        document.body.appendChild(root)
        try {
            const pending = inject('app:e2e-async')(leaf)
            let releases = 0
            const providerBlueprint = pipe(
                createContext({ count: 0 }),
                provide('app:e2e-async', async () => {
                    await settle(3)
                    releases += 1
                    return 'async-value'
                }, { eager: true }),
            )
            const provider = await mount(providerBlueprint, { token: 'app:e2e-async-host' })(root)
            try {
                await settle()
                await expect(pending).resolves.toBe('async-value')
                expect(releases).toBe(1)
            } finally {
                dispose(provider)
            }
        } finally {
            root.remove()
        }
    })

    it('settles a pending multi inject flat on its own mount with no further key change', async () => {
        const root = document.createElement('div')
        const middle = document.createElement('div')
        const leaf = document.createElement('span')
        middle.appendChild(leaf)
        root.appendChild(middle)
        document.body.appendChild(root)
        try {
            const pending = injectAll('app:e2e-tags')(leaf)
            const rootBlueprint = pipe(
                createContext({ count: 0 }),
                provideSync('app:e2e-tags', () => 'far-tag', { multi: true }),
            )
            const middleBlueprint = pipe(
                createContext({ count: 0 }),
                provideSync('app:e2e-tags', () => 'near-tag', { multi: true }),
            )
            const outer = mountSync(rootBlueprint, { token: 'app:e2e-tags-outer' })(root)
            const inner = mountSync(middleBlueprint, { token: 'app:e2e-tags-inner' })(middle)
            try {
                await settle()
                await expect(pending).resolves.toEqual(['near-tag', 'far-tag'])
            } finally {
                dispose(inner)
                dispose(outer)
            }
        } finally {
            root.remove()
        }
    })

    it('wakes a pending inject through a synthesized context-mount announcement', async () => {
        const root = document.createElement('div')
        const leaf = document.createElement('span')
        root.appendChild(leaf)
        document.body.appendChild(root)
        try {
            const seen: Array<CustomEvent> = []
            const onMount = (event: Event): void => {
                seen.push(event as CustomEvent)
            }
            document.addEventListener('context-mount', onMount)
            try {
                const pending = inject('app:e2e-announce')(leaf)
                const provider = await mount(pipe(
                    createContext({ count: 0 }),
                    provideSync('app:e2e-announce', () => 'announced-value'),
                ))(root)
                try {
                    await settle()
                    expect(seen.length).toBeGreaterThan(0)
                    await expect(pending).resolves.toBe('announced-value')
                } finally {
                    dispose(provider)
                }
            } finally {
                document.removeEventListener('context-mount', onMount)
            }
        } finally {
            root.remove()
        }
    })

    it('re-evaluates a pending inject after a structure change moves the consumer', async () => {
        const outer = document.createElement('div')
        const holder = document.createElement('div')
        document.body.appendChild(outer)
        document.body.appendChild(holder)
        try {
            const provider = await mount(pipe(
                createContext({ count: 0 }),
                provideSync('app:e2e-move', () => 'moved-value'),
            ))(outer)
            try {
                const leaf = document.createElement('span')
                holder.appendChild(leaf)
                const pending = inject('app:e2e-move')(leaf)
                outer.appendChild(leaf)
                await settle()
                await expect(pending).resolves.toBe('moved-value')
            } finally {
                dispose(provider)
            }
        } finally {
            outer.remove()
            holder.remove()
        }
    })

    it('settles a sync mount pending inject on its own mount announcement', async () => {
        const root = document.createElement('div')
        const leaf = document.createElement('span')
        root.appendChild(leaf)
        document.body.appendChild(root)
        try {
            const pending = inject('app:e2e-sync')(leaf)
            const session = mountSync(pipe(
                createContext({ count: 0 }),
                provideSync('app:e2e-sync', () => 'sync-value'),
            ))(root)
            try {
                await settle()
                await expect(pending).resolves.toBe('sync-value')
            } finally {
                dispose(session)
            }
        } finally {
            root.remove()
        }
    })
})
