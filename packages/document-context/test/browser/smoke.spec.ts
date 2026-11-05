import { expect, test } from '@playwright/test'
import type * as DC from '../../src/index'

test('smoke: loads harness and library in Chromium', async ({ page }) => {
    await page.goto('/test/browser/index.html')
    await page.waitForFunction(() => (window as unknown as { __DC_READY__?: boolean }).__DC_READY__ === true)

    const hasExports = await page.evaluate(() => {
        const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
        return (
            typeof dc.mount === 'function' &&
            typeof dc.createContext === 'function' &&
            typeof dc.defineToken === 'function' &&
            typeof dc.provide === 'function' &&
            typeof dc.inject === 'function'
        )
    })

    expect(hasExports).toBe(true)
})
