import { expect, test } from '@playwright/test'
import type * as DC from '../../src/index'

test.describe('[PW-4 / PW-5] Microtask Checkpoint, Disconnection & Reparenting', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/test/browser/index.html')
        await page.waitForFunction(() => (window as unknown as { __DC_READY__?: boolean }).__DC_READY__ === true)
    })

    test('[PW-4] real browser requestAnimationFrame frame timing operates via scheduler', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const scheduler = dc.getDefaultApplication().ports.host.scheduler

            let frameExecuted = false
            let syncCheck = false
            let microtaskCheck = false

            // Schedule frame via library scheduler
            scheduler.frame(() => {
                frameExecuted = true
            })

            syncCheck = frameExecuted
            await Promise.resolve()
            microtaskCheck = frameExecuted

            // Wait for real browser animation frame
            await new Promise((r) => requestAnimationFrame(r))
            const postFrameCheck = frameExecuted

            // Verify cancellation handle works
            let cancelledRan = false
            const cancel = scheduler.frame(() => {
                cancelledRan = true
            })
            cancel()
            await new Promise((r) => requestAnimationFrame(r))

            return {
                syncCheck,
                microtaskCheck,
                postFrameCheck,
                cancelledRan,
            }
        })

        expect(result.syncCheck).toBe(false)
        expect(result.microtaskCheck).toBe(false)
        expect(result.postFrameCheck).toBe(true)
        expect(result.cancelledRan).toBe(false)
    })

    test('[PW-5] reparenting node within microtask checkpoint does not disconnect session', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { createContext, mount, pipe } = dc

            const container1 = document.createElement('div')
            const container2 = document.createElement('div')
            document.body.appendChild(container1)
            document.body.appendChild(container2)

            const host = document.createElement('section')
            container1.appendChild(host)

            const session = mount(pipe(createContext({ count: 1 })))(host)
            await session.ready

            const initialStatus = session.status

            // Reparent in the same synchronous task
            container1.removeChild(host)
            container2.appendChild(host)

            // Let microtasks and MutationObserver settle
            await new Promise((r) => setTimeout(r, 50))

            return {
                initialStatus,
                statusAfterReparent: session.status,
                isDisposed: session.status === 'disposed',
            }
        })

        expect(result.initialStatus).toBe('active')
        expect(result.statusAfterReparent).toBe('active')
        expect(result.isDisposed).toBe(false)
    })

    test('[PW-5] anonymous session confirmed disconnected after microtask is disposed', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { createContext, mount, pipe, update } = dc

            const container = document.createElement('div')
            document.body.appendChild(container)

            const host = document.createElement('section')
            container.appendChild(host)

            const session = mount(pipe(createContext({ count: 1 })))(host)
            await session.ready

            const initialStatus = session.status

            // Remove node completely
            host.remove()

            // Wait for MutationObserver and microtask recheck to complete
            await new Promise((r) => setTimeout(r, 50))

            // Update on disposed session should return false
            const updateResult = update((s: { count: number }) => ({ count: s.count + 1 }))(session)

            return {
                initialStatus,
                statusAfterDisconnect: session.status,
                updateResult,
            }
        })

        expect(result.initialStatus).toBe('active')
        expect(result.statusAfterDisconnect).toBe('disposed')
        expect(result.updateResult).toBe(false)
    })

    test('[PW-5] keyed session confirmed disconnected is suspended and resuscitated with retained state', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { createContext, mount, pipe, read, update } = dc

            const container = document.createElement('div')
            document.body.appendChild(container)

            const host1 = document.createElement('section')
            container.appendChild(host1)

            const session1 = mount(
                pipe(createContext({ username: 'Alice', score: 10 })),
                { token: 'player:session' },
            )(host1)
            await session1.ready

            // Update state while active
            update((s: { username: string; score: number }) => ({
                ...s,
                score: 25,
            }))(session1)

            // Disconnect host1
            host1.remove()

            // Wait for MutationObserver and microtask recheck
            await new Promise((r) => setTimeout(r, 50))

            const statusAfterDisconnect = session1.status

            // Resuscitate on a new host in the document with the same token
            const host2 = document.createElement('section')
            container.appendChild(host2)

            const session2 = mount(
                pipe(createContext({ username: 'seed-default', score: 0 })),
                { token: 'player:session' },
            )(host2)
            await session2.ready

            const scoreOnResumed = read((s: { username: string; score: number }) => s.score)(session2)
            const userOnResumed = read((s: { username: string; score: number }) => s.username)(session2)

            return {
                statusAfterDisconnect,
                statusAfterResume: session2.status,
                scoreOnResumed,
                userOnResumed,
            }
        })

        expect(result.statusAfterDisconnect).toBe('suspended')
        expect(result.statusAfterResume).toBe('active')
        expect(result.scoreOnResumed).toBe(25) // Retained state, does not revert to seed
        expect(result.userOnResumed).toBe('Alice')
    })

    test('[PW-5] reconnecting node after confirmed disconnect does not revive disposed anonymous session', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { createContext, mount, pipe, update } = dc

            const container1 = document.createElement('div')
            const container2 = document.createElement('div')
            document.body.appendChild(container1)
            document.body.appendChild(container2)

            const host = document.createElement('section')
            container1.appendChild(host)

            const session = mount(pipe(createContext({ count: 42 })))(host)
            await session.ready

            // 1. Remove host from DOM
            host.remove()

            // 2. Wait past microtask checkpoint for confirmed disconnect
            await new Promise((r) => setTimeout(r, 50))
            const statusAfterCheckpoint = session.status

            // 3. Re-append host back into DOM after confirmation
            container2.appendChild(host)

            // 4. Wait another microtask cycle
            await new Promise((r) => setTimeout(r, 50))
            const statusAfterReconnection = session.status
            const updateResult = update((s: { count: number }) => ({ count: s.count + 1 }))(session)

            return {
                statusAfterCheckpoint,
                statusAfterReconnection,
                updateResult,
                hostIsConnectedNow: host.isConnected,
            }
        })

        expect(result.statusAfterCheckpoint).toBe('disposed')
        expect(result.statusAfterReconnection).toBe('disposed')
        expect(result.updateResult).toBe(false)
        expect(result.hostIsConnectedNow).toBe(true)
    })
})
