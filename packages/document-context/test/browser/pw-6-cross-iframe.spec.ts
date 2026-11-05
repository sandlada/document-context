import { expect, test } from '@playwright/test'
import type * as DC from '../../src/index'

test.describe('[PW-6] Cross-iframe Document Boundary Scope Isolation (SCOPE #2)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/test/browser/index.html')
        await page.waitForFunction(() => (window as unknown as { __DC_READY__?: boolean }).__DC_READY__ === true)
    })

    test('[PW-6] scope chain does not cross document boundary from iframe into parent document', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { createContext, defineToken, mount, pipe, provide } = dc

            const token = defineToken<{ value: string }>('public')('demo:shared-service')
            const host = document.createElement('div')
            document.body.appendChild(host)

            const session = mount(
                pipe(
                    createContext({}),
                    provide(token, () => ({ value: 'parent-value' })),
                ),
            )(host)
            await session.ready

            // Create iframe
            const iframe = document.createElement('iframe')
            document.body.appendChild(iframe)
            await new Promise((r) => {
                iframe.onload = r
                iframe.src = '/test/browser/iframe.html'
            })

            const iframeWindow = iframe.contentWindow as unknown as { __DC_READY__?: boolean; DocumentContext: typeof DC }
            if (!iframeWindow.__DC_READY__) {
                await new Promise((r) => {
                    const check = setInterval(() => {
                        if (iframeWindow.__DC_READY__) {
                            clearInterval(check)
                            r(undefined)
                        }
                    }, 10)
                })
            }

            const iframeDC = iframeWindow.DocumentContext
            const iframeConsumerEl = iframe.contentDocument!.createElement('button')
            iframe.contentDocument!.body.appendChild(iframeConsumerEl)

            const iframeSession = iframeDC.mount(iframeDC.pipe(iframeDC.createContext({})))(iframeConsumerEl)
            await iframeSession.ready

            try {
                await iframeDC.inject(token, { wait: false })(iframeSession)
                return { resolved: true, errorCode: null }
            } catch (err: unknown) {
                const error = err as { code?: string; message?: string }
                return { resolved: false, errorCode: error.code || error.message }
            }
        })

        expect(result.resolved).toBe(false)
        expect(result.errorCode).toBe('UNKNOWN_SERVICE')
    })

    test('[PW-6] parent document scope chain does not resolve providers inside iframe', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { createContext, defineToken, inject, mount, pipe } = dc
            const token = defineToken<{ secret: string }>('public')('iframe:isolated-secret')

            const iframe = document.createElement('iframe')
            document.body.appendChild(iframe)
            await new Promise((r) => {
                iframe.onload = r
                iframe.src = '/test/browser/iframe.html'
            })

            const iframeWindow = iframe.contentWindow as unknown as { __DC_READY__?: boolean; DocumentContext: typeof DC }
            if (!iframeWindow.__DC_READY__) {
                await new Promise((r) => {
                    const check = setInterval(() => {
                        if (iframeWindow.__DC_READY__) {
                            clearInterval(check)
                            r(undefined)
                        }
                    }, 10)
                })
            }

            const iframeDC = iframeWindow.DocumentContext
            const iframeHost = iframe.contentDocument!.createElement('div')
            iframe.contentDocument!.body.appendChild(iframeHost)

            const iframeSession = iframeDC.mount(
                iframeDC.pipe(
                    iframeDC.createContext({}),
                    iframeDC.provide(token, () => ({ secret: 'iframe-only-data' })),
                ),
            )(iframeHost)
            await iframeSession.ready

            // Parent attempts to inject iframe's provider
            const parentConsumer = document.createElement('div')
            document.body.appendChild(parentConsumer)

            const parentSession = mount(pipe(createContext({})))(parentConsumer)
            await parentSession.ready

            try {
                await inject(token, { wait: false })(parentSession)
                return { resolved: true, errorCode: null }
            } catch (err: unknown) {
                const error = err as { code?: string; message?: string }
                return { resolved: false, errorCode: error.code || error.message }
            }
        })

        expect(result.resolved).toBe(false)
        expect(result.errorCode).toBe('UNKNOWN_SERVICE')
    })

    test('[PW-6] context-request DOM events dispatched inside iframe do not leak to parent document', async ({ page }) => {
        const result = await page.evaluate(async () => {
            let parentReceivedEvent = false
            window.addEventListener('context-request', () => {
                parentReceivedEvent = true
            })

            const iframe = document.createElement('iframe')
            document.body.appendChild(iframe)

            await new Promise((r) => {
                iframe.onload = r
                iframe.src = '/test/browser/iframe.html'
            })

            const iframeDoc = iframe.contentDocument!
            const iframeBtn = iframeDoc.createElement('button')
            iframeDoc.body.appendChild(iframeBtn)

            iframeBtn.dispatchEvent(
                new CustomEvent('context-request', {
                    bubbles: true,
                    composed: true,
                    detail: {
                        context: 'leak:test',
                        callback: () => undefined,
                    },
                }),
            )

            // Microtask wait
            await new Promise((r) => setTimeout(r, 20))

            return {
                parentReceivedEvent,
                iframeDocNotEqualParentDoc: iframeDoc !== document,
            }
        })

        expect(result.iframeDocNotEqualParentDoc).toBe(true)
        expect(result.parentReceivedEvent).toBe(false)
    })

    test('[PW-6] element-target injection inside iframe does not cross document boundary to parent provider', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { createContext, defineToken, mount, pipe, provide } = dc

            const token = defineToken<{ value: string }>('public')('app:theme')

            // Mount provider in parent document
            const parentHost = document.createElement('div')
            document.body.appendChild(parentHost)
            const parentSession = mount(
                pipe(
                    createContext({}),
                    provide(token, () => ({ value: 'parent-theme' })),
                ),
            )(parentHost)
            await parentSession.ready

            // Load iframe inside parentHost
            const iframe = document.createElement('iframe')
            parentHost.appendChild(iframe)
            await new Promise((r) => {
                iframe.onload = r
                iframe.src = '/test/browser/iframe.html'
            })

            const iframeWindow = iframe.contentWindow as unknown as { __DC_READY__?: boolean; DocumentContext: typeof DC }
            if (!iframeWindow.__DC_READY__) {
                await new Promise((r) => {
                    const check = setInterval(() => {
                        if (iframeWindow.__DC_READY__) {
                            clearInterval(check)
                            r(undefined)
                        }
                    }, 10)
                })
            }

            const iframeDC = iframeWindow.DocumentContext
            const iframeEl = iframe.contentDocument!.createElement('button')
            iframe.contentDocument!.body.appendChild(iframeEl)

            // Inject using Element target inside iframe
            let settled = false
            let settledValue: unknown = null
            let rejectionError: string | null = null

            const pending = iframeDC.inject(token)(iframeEl).then(
                (v) => {
                    settled = true
                    settledValue = v
                },
                (err: unknown) => {
                    settled = true
                    const error = err as { code?: string; message?: string }
                    rejectionError = error.code || error.message || 'ERROR'
                },
            )

            // Wait 50ms - should NOT resolve from parent document provider
            await new Promise((r) => setTimeout(r, 50))
            const settledWhileConnected = settled

            // Parent sessionAt cannot see inside iframe element
            const parentSessionAtIframeEl = dc.sessionAt(iframeEl)

            // Disconnect iframe element to conclude pending wait
            iframeEl.remove()
            await new Promise((r) => setTimeout(r, 50))

            return {
                settledWhileConnected,
                settledValue,
                settledAfterDisconnect: settled,
                rejectionError,
                parentSessionAtIframeElIsNull: parentSessionAtIframeEl === null,
            }
        })

        expect(result.settledWhileConnected).toBe(false)
        expect(result.settledValue).toBe(null)
        expect(result.settledAfterDisconnect).toBe(true)
        expect(result.rejectionError).toBe('UNCONNECTED_HOST')
        expect(result.parentSessionAtIframeElIsNull).toBe(true)
    })

    test('[PW-6] keyed sessions with identical token in parent and iframe coexist without KEYED_CONFLICT', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { createContext, mount, pipe, read, update } = dc

            const tokenName = 'player:profile'

            // Parent mount keyed session
            const parentEl = document.createElement('div')
            document.body.appendChild(parentEl)
            const parentSession = mount(
                pipe(createContext({ name: 'Alice' })),
                { token: tokenName },
            )(parentEl)
            await parentSession.ready

            // Iframe mount keyed session with SAME token
            const iframe = document.createElement('iframe')
            document.body.appendChild(iframe)
            await new Promise((r) => {
                iframe.onload = r
                iframe.src = '/test/browser/iframe.html'
            })

            const iframeWindow = iframe.contentWindow as unknown as { __DC_READY__?: boolean; DocumentContext: typeof DC }
            if (!iframeWindow.__DC_READY__) {
                await new Promise((r) => {
                    const check = setInterval(() => {
                        if (iframeWindow.__DC_READY__) {
                            clearInterval(check)
                            r(undefined)
                        }
                    }, 10)
                })
            }

            const iframeDC = iframeWindow.DocumentContext
            const iframeEl = iframe.contentDocument!.createElement('div')
            iframe.contentDocument!.body.appendChild(iframeEl)

            const iframeSession = iframeDC.mount(
                iframeDC.pipe(iframeDC.createContext({ name: 'Bob' })),
                { token: tokenName },
            )(iframeEl)
            await iframeSession.ready

            // Updates on each session remain independent
            update((s: { name: string }) => ({ name: 'Alice-Updated' }))(parentSession)
            iframeDC.update((s: { name: string }) => ({ name: 'Bob-Updated' }))(iframeSession)

            return {
                parentStatus: parentSession.status,
                iframeStatus: iframeSession.status,
                parentName: read((s: { name: string }) => s.name)(parentSession),
                iframeName: iframeDC.read((s: { name: string }) => s.name)(iframeSession),
            }
        })

        expect(result.parentStatus).toBe('active')
        expect(result.iframeStatus).toBe('active')
        expect(result.parentName).toBe('Alice-Updated')
        expect(result.iframeName).toBe('Bob-Updated')
    })
})
