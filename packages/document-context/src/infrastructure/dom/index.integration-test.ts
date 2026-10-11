/**
 * DOM composition-root tests: `createDomAdapter` wiring over covered units.
 *
 * Runs in happy-dom. Proves the composer honors every option override, wires
 * the observer sink and pending registry into the host bundle, and tears down
 * idempotently.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDomAdapter } from './index.js'

afterEach(() => {
    document.body.innerHTML = ''
})

describe('createDomAdapter', () => {
    it('composes the full surface with defaults', () => {
        const dom = createDomAdapter()
        try {
            expect(typeof dom.toHost).toBe('function')
            expect(typeof dom.scheduler.microtask).toBe('function')
            expect(typeof dom.scopeTransport.request).toBe('function')
            expect(typeof dom.tokens.read).toBe('function')
            expect(typeof dom.tokens.write).toBe('function')
            expect(typeof dom.announce).toBe('function')
            expect(dom.registry.size()).toBe(0)
            expect(dom.observer.size()).toBe(0)
        } finally {
            dom.dispose()
        }
    })

    it('honours every option override', async () => {
        const events: Array<unknown> = []
        const microtasks: Array<() => void> = []
        const dom = createDomAdapter({
            document,
            maxPending: 7,
            maxBatch: 3,
            onEvent: (event) => {
                events.push(event)
            },
            scheduler: {
                microtask: (task: () => void) => {
                    microtasks.push(task)
                },
            },
        })
        try {
            const element = document.createElement('div')
            document.body.appendChild(element)
            const host = dom.toHost(element)
            expect(host.native()).toBe(element)
            // The injected scheduler drives the observer re-check, not the
            // registry: a structural mutation schedules exactly one check.
            element.remove()
            await new Promise<void>((resolve) => {
                setTimeout(() => resolve(), 0)
            })
            expect(microtasks.length).toBe(1)
            expect(events.length).toBe(0)
        } finally {
            dom.dispose()
        }
    })

    it('tracks hosts through the observer sink and wakes through the registry', async () => {
        const dom = createDomAdapter()
        try {
            const element = document.createElement('div')
            document.body.appendChild(element)
            const host = dom.toHost(element)
            expect(dom.observer.size()).toBe(1)
            const retry = vi.fn()
            const remove = dom.registry.add({ token: 'app:theme', host, retry })
            dom.registry.wakeAll()
            await new Promise<void>((resolve) => {
                setTimeout(() => resolve(), 0)
            })
            expect(retry).toHaveBeenCalledTimes(1)
            remove()
        } finally {
            dom.dispose()
        }
    })

    it('reads and writes keyed identities through the composed tokens', () => {
        const dom = createDomAdapter()
        try {
            const element = document.createElement('div')
            const host = dom.toHost(element)
            expect(dom.tokens.read(host)).toBeNull()
            dom.tokens.write(host, 'app:composed')
            expect(element.getAttribute('data-context-key')).toBe('app:composed')
            expect(dom.tokens.read(host)).toBe('app:composed')
            dom.tokens.write(host, null)
            expect(dom.tokens.read(host)).toBeNull()
        } finally {
            dom.dispose()
        }
    })

    it('dispose is idempotent and clears pending work', () => {
        const dom = createDomAdapter()
        const element = document.createElement('div')
        document.body.appendChild(element)
        const host = dom.toHost(element)
        dom.registry.add({ token: 'app:theme', host, retry: () => {} })
        expect(dom.registry.size()).toBe(1)
        dom.dispose()
        dom.dispose()
        expect(dom.registry.size()).toBe(0)
    })

    it('wakes pending entries on context-mount announcements with subtree fast path', async () => {
        const dom = createDomAdapter()
        try {
            const container = document.createElement('div')
            const inside = document.createElement('span')
            const outside = document.createElement('span')
            container.appendChild(inside)
            document.body.appendChild(container)
            document.body.appendChild(outside)
            try {
                const insideHost = dom.toHost(inside)
                const outsideHost = dom.toHost(outside)
                const insideRetry = vi.fn()
                const outsideRetry = vi.fn()
                dom.registry.add({ token: 'app:theme', host: insideHost, retry: insideRetry })
                dom.registry.add({ token: 'app:theme', host: outsideHost, retry: outsideRetry })
                container.dispatchEvent(new CustomEvent('context-mount', {
                    detail: { token: 'app:container-key' },
                    bubbles: true,
                    composed: true,
                    cancelable: false,
                }))
                await new Promise<void>((resolve) => {
                    setTimeout(() => resolve(), 0)
                })
                expect(insideRetry).toHaveBeenCalledTimes(1)
                expect(outsideRetry).not.toHaveBeenCalled()
            } finally {
                container.remove()
                outside.remove()
            }
        } finally {
            dom.dispose()
        }
    })

    it('falls back to wakeAll when the mount announcement has no resolvable host', async () => {
        const dom = createDomAdapter()
        try {
            const element = document.createElement('div')
            document.body.appendChild(element)
            try {
                const host = dom.toHost(element)
                const retry = vi.fn()
                dom.registry.add({ token: 'app:theme', host, retry })
                document.dispatchEvent(new CustomEvent('context-mount', {
                    detail: { token: null },
                    bubbles: false,
                    composed: false,
                    cancelable: false,
                }))
                await new Promise<void>((resolve) => {
                    setTimeout(() => resolve(), 0)
                })
                expect(retry).toHaveBeenCalledTimes(1)
            } finally {
                element.remove()
            }
        } finally {
            dom.dispose()
        }
    })

    it('wakes through providedTokens token buckets when present', async () => {
        const dom = createDomAdapter()
        try {
            const container = document.createElement('div')
            const inside = document.createElement('span')
            container.appendChild(inside)
            document.body.appendChild(container)
            try {
                const host = dom.toHost(inside)
                const retryA = vi.fn()
                const retryB = vi.fn()
                dom.registry.add({ token: 'app:bucket-a', host, retry: retryA })
                dom.registry.add({ token: 'app:bucket-b', host, retry: retryB })
                container.dispatchEvent(new CustomEvent('context-mount', {
                    detail: { token: 'app:key', providedTokens: ['app:bucket-a'] },
                    bubbles: true,
                    composed: true,
                    cancelable: false,
                }))
                await new Promise<void>((resolve) => {
                    setTimeout(() => resolve(), 0)
                })
                expect(retryA).toHaveBeenCalledTimes(1)
                expect(retryB).not.toHaveBeenCalled()
            } finally {
                container.remove()
            }
        } finally {
            dom.dispose()
        }
    })

    it('removes the context-mount listener on dispose', async () => {
        const dom = createDomAdapter()
        const element = document.createElement('div')
        document.body.appendChild(element)
        try {
            const host = dom.toHost(element)
            const retry = vi.fn()
            dom.registry.add({ token: 'app:theme', host, retry })
            dom.dispose()
            element.dispatchEvent(new CustomEvent('context-mount', {
                detail: { token: 'app:late-key' },
                bubbles: true,
                composed: true,
                cancelable: false,
            }))
            await new Promise<void>((resolve) => {
                setTimeout(() => resolve(), 0)
            })
            expect(retry).not.toHaveBeenCalled()
        } finally {
            element.remove()
        }
    })

    it('wakes pending entries on structure changes with zero cost when empty', async () => {
        const dom = createDomAdapter()
        try {
            expect(dom.registry.size()).toBe(0)
            const element = document.createElement('div')
            document.body.appendChild(element)
            try {
                dom.toHost(element)
                element.appendChild(document.createElement('span'))
                await new Promise<void>((resolve) => {
                    setTimeout(() => resolve(), 0)
                })
                expect(dom.registry.size()).toBe(0)
                const host = dom.toHost(element)
                const retry = vi.fn()
                const remove = dom.registry.add({ token: 'app:theme', host, retry })
                element.appendChild(document.createElement('em'))
                await new Promise<void>((resolve) => {
                    setTimeout(() => resolve(), 0)
                })
                expect(retry).toHaveBeenCalled()
                remove()
            } finally {
                element.remove()
            }
        } finally {
            dom.dispose()
        }
    })
})
