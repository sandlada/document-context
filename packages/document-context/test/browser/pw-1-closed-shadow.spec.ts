import { expect, test } from '@playwright/test'
import type * as DC from '../../src/index'

test.describe('[PW-1] Closed Shadow DOM and Event Penetration', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/test/browser/index.html')
        await page.waitForFunction(() => (window as unknown as { __DC_READY__?: boolean }).__DC_READY__ === true)
    })

    test('[PW-1] closed shadow root external accessibility is null', async ({ page }) => {
        const result = await page.evaluate(() => {
            const host = document.createElement('div')
            document.body.appendChild(host)
            const shadow = host.attachShadow({ mode: 'closed' })
            const inner = document.createElement('span')
            inner.textContent = 'hidden inside closed shadow'
            shadow.appendChild(inner)

            return {
                externalShadowRootIsNull: host.shadowRoot === null,
                innerParentIsShadowRoot: inner.getRootNode() === shadow,
                innerParentNodeType: inner.getRootNode().nodeType,
            }
        })

        expect(result.externalShadowRootIsNull).toBe(true)
        expect(result.innerParentIsShadowRoot).toBe(true)
        expect(result.innerParentNodeType).toBe(11) // Node.DOCUMENT_FRAGMENT_NODE
    })

    test('[PW-1] composed event penetration resolves provider in light DOM from inside closed shadow', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { createContext, defineToken, inject, mount, pipe, provide } = dc

            const loggerToken = defineToken<{ log(msg: string): string }>('public')('app:logger')

            // 1. Light DOM parent host providing loggerToken
            const parentHost = document.createElement('section')
            document.body.appendChild(parentHost)

            const parentBlueprint = pipe(
                createContext({ name: 'parent' }),
                provide(loggerToken, () => ({
                    log: (msg: string) => `parent-logger:${msg}`,
                })),
            )
            const parentSession = mount(parentBlueprint)(parentHost)
            await parentSession.ready

            // 2. Closed shadow DOM host inside parentHost
            const shadowHost = document.createElement('div')
            parentHost.appendChild(shadowHost)
            const closedShadow = shadowHost.attachShadow({ mode: 'closed' })

            // 3. Child element inside closed shadow root
            const consumerEl = document.createElement('button')
            closedShadow.appendChild(consumerEl)

            // 4. Inject from inside closed shadow DOM
            const logger = await inject(loggerToken)(consumerEl)
            const message = logger.log('hello-from-shadow')

            return {
                message,
                parentStatus: parentSession.status,
            }
        })

        expect(result.message).toBe('parent-logger:hello-from-shadow')
        expect(result.parentStatus).toBe('active')
    })

    test('[PW-1] nearest-wins resolution across closed shadow root boundary', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { createContext, defineToken, inject, mount, pipe, provide } = dc

            const themeToken = defineToken<{ theme: string }>('public')('app:theme')

            // Outer host provides light theme
            const outerHost = document.createElement('div')
            document.body.appendChild(outerHost)
            const outerSession = mount(
                pipe(
                    createContext({}),
                    provide(themeToken, () => ({ theme: 'light' })),
                ),
            )(outerHost)
            await outerSession.ready

            // Closed shadow DOM element
            const shadowHost = document.createElement('div')
            outerHost.appendChild(shadowHost)
            const closedShadow = shadowHost.attachShadow({ mode: 'closed' })

            // Inside closed shadow root, an inner provider provides dark theme
            const innerProviderEl = document.createElement('div')
            closedShadow.appendChild(innerProviderEl)
            const innerSession = mount(
                pipe(
                    createContext({}),
                    provide(themeToken, () => ({ theme: 'dark' })),
                ),
            )(innerProviderEl)
            await innerSession.ready

            // Consumer inside the inner provider
            const innerConsumerEl = document.createElement('span')
            innerProviderEl.appendChild(innerConsumerEl)

            // Consumer outside the shadow root
            const outerConsumerEl = document.createElement('span')
            outerHost.appendChild(outerConsumerEl)

            const innerResult = await inject(themeToken)(innerConsumerEl)
            const outerResult = await inject(themeToken)(outerConsumerEl)

            return {
                innerTheme: innerResult.theme,
                outerTheme: outerResult.theme,
            }
        })

        expect(result.innerTheme).toBe('dark')
        expect(result.outerTheme).toBe('light')
    })

    test('[PW-1] fallback to light DOM ancestor when closed shadow does not provide the requested token', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { createContext, defineToken, inject, mount, pipe, provide } = dc

            const outerToken = defineToken<{ name: string }>('public')('app:outer')
            const innerToken = defineToken<{ name: string }>('public')('app:inner')

            // Outer provides outerToken
            const outerHost = document.createElement('div')
            document.body.appendChild(outerHost)
            const outerSession = mount(
                pipe(
                    createContext({}),
                    provide(outerToken, () => ({ name: 'outer-service' })),
                ),
            )(outerHost)
            await outerSession.ready

            // Closed shadow host
            const shadowHost = document.createElement('div')
            outerHost.appendChild(shadowHost)
            const closedShadow = shadowHost.attachShadow({ mode: 'closed' })

            // Inner element provides innerToken only
            const innerEl = document.createElement('div')
            closedShadow.appendChild(innerEl)
            const innerSession = mount(
                pipe(
                    createContext({}),
                    provide(innerToken, () => ({ name: 'inner-service' })),
                ),
            )(innerEl)
            await innerSession.ready

            const consumer = document.createElement('button')
            innerEl.appendChild(consumer)

            // Inject outerToken from inside closed shadow
            const resolvedOuter = await inject(outerToken)(consumer)
            const resolvedInner = await inject(innerToken)(consumer)

            return {
                outerName: resolvedOuter.name,
                innerName: resolvedInner.name,
            }
        })

        expect(result.outerName).toBe('outer-service')
        expect(result.innerName).toBe('inner-service')
    })
})
