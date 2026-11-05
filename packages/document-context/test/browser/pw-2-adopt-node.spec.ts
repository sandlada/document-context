import { expect, test } from '@playwright/test'
import type * as DC from '../../src/index'

test.describe('[PW-2] document.adoptNode Across Documents', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/test/browser/index.html')
        await page.waitForFunction(() => (window as unknown as { __DC_READY__?: boolean }).__DC_READY__ === true)
    })

    test('[PW-2] document.adoptNode updates isConnected fact and ownerDocument synchronously', async ({ page }) => {
        const result = await page.evaluate(() => {
            const host = document.createElement('div')
            document.body.appendChild(host)

            const initialOwner = host.ownerDocument === document
            const initialConnected = host.isConnected

            const docB = document.implementation.createHTMLDocument('docB')
            docB.adoptNode(host)

            const afterAdoptOwner = host.ownerDocument === docB
            const afterAdoptConnected = host.isConnected // Adopted node is detached until appended

            docB.body.appendChild(host)
            const afterAppendOwner = host.ownerDocument === docB
            const afterAppendConnected = host.isConnected

            return {
                initialOwner,
                initialConnected,
                afterAdoptOwner,
                afterAdoptConnected,
                afterAppendOwner,
                afterAppendConnected,
            }
        })

        expect(result.initialOwner).toBe(true)
        expect(result.initialConnected).toBe(true)
        expect(result.afterAdoptOwner).toBe(true)
        expect(result.afterAdoptConnected).toBe(false)
        expect(result.afterAppendOwner).toBe(true)
        expect(result.afterAppendConnected).toBe(true)
    })

    test('[PW-2] session remains active and triggers onAdopt hook when adopted across documents', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { attach, createContext, mount, onAdopt, pipe, read, update } = dc

            const host = document.createElement('div')
            document.body.appendChild(host)

            const hookEvents: string[] = []
            let attachAdoptedDoc: string | null = null

            const blueprint = pipe(
                createContext({ count: 100 }),
                onAdopt(() => {
                    hookEvents.push('blueprint:onAdopt')
                }),
            )

            const session = mount(blueprint)(host)
            await session.ready

            attach({
                onAdopt: (owner: Document) => {
                    attachAdoptedDoc = owner.title
                },
            })(session)

            const lifecycleEvents: string[] = []
            session.lifecycle$.subscribe((ev: { type: string }) => {
                lifecycleEvents.push(ev.type)
            })

            // Create secondary document and adopt the host element
            const docB = document.implementation.createHTMLDocument('Document B')
            docB.adoptNode(host)
            docB.body.appendChild(host)

            // Allow microtasks and MutationObserver to settle
            await new Promise((r) => setTimeout(r, 50))

            // Verify state operations work in adopted document
            const initialRead = read((s: { count: number }) => s.count)(session)
            update((s: { count: number }) => ({ count: s.count + 1 }))(session)
            const updatedRead = read((s: { count: number }) => s.count)(session)

            return {
                status: session.status,
                initialRead,
                updatedRead,
                hookEvents,
                attachAdoptedDoc,
                lifecycleEvents,
            }
        })

        expect(result.status).toBe('active')
        expect(result.initialRead).toBe(100)
        expect(result.updatedRead).toBe(101)
        expect(result.hookEvents).toEqual(['blueprint:onAdopt'])
        expect(result.attachAdoptedDoc).toBe('Document B')
        expect(result.lifecycleEvents).toEqual(['active', 'adopted'])
    })

    test('[PW-2] multi-document adoption (docA -> docB -> docC) preserves session and fires onAdopt per transition', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { attach, createContext, mount, onAdopt, pipe, read, update } = dc

            const host = document.createElement('div')
            document.body.appendChild(host)

            let onAdoptCount = 0
            const attachedDocs: string[] = []

            const session = mount(
                pipe(
                    createContext({ score: 50 }),
                    onAdopt(() => {
                        onAdoptCount++
                    }),
                ),
            )(host)
            await session.ready

            attach({
                onAdopt: (owner: Document) => {
                    attachedDocs.push(owner.title)
                },
            })(session)

            // 1. Adopt to docB
            const docB = document.implementation.createHTMLDocument('Document B')
            docB.adoptNode(host)
            docB.body.appendChild(host)
            await new Promise((r) => setTimeout(r, 40))

            // 2. Adopt to docC
            const docC = document.implementation.createHTMLDocument('Document C')
            docC.adoptNode(host)
            docC.body.appendChild(host)
            await new Promise((r) => setTimeout(r, 40))

            // 3. State update in docC
            update((s: { score: number }) => ({ score: s.score + 25 }))(session)
            const finalScore = read((s: { score: number }) => s.score)(session)

            return {
                status: session.status,
                finalScore,
                onAdoptCount,
                attachedDocs,
                currentDocTitle: host.ownerDocument.title,
                isConnected: host.isConnected,
            }
        })

        expect(result.status).toBe('active')
        expect(result.finalScore).toBe(75)
        expect(result.onAdoptCount).toBe(2)
        expect(result.attachedDocs).toEqual(['Document B', 'Document C'])
        expect(result.currentDocTitle).toBe('Document C')
        expect(result.isConnected).toBe(true)
    })

    test('[PW-2] dependency resolution works for child elements appended in new document after adoption', async ({ page }) => {
        const result = await page.evaluate(async () => {
            const dc = (window as unknown as { DocumentContext: typeof DC }).DocumentContext
            const { createContext, defineToken, inject, mount, pipe, provide } = dc

            const calcToken = defineToken<{ double(n: number): number }>('public')('app:calculator')
            const host = document.createElement('div')
            document.body.appendChild(host)

            const session = mount(
                pipe(
                    createContext({}),
                    provide(calcToken, () => ({
                        double: (n: number) => n * 2,
                    })),
                ),
            )(host)
            await session.ready

            // Adopt host into Document B
            const docB = document.implementation.createHTMLDocument('Document B')
            docB.adoptNode(host)
            docB.body.appendChild(host)
            await new Promise((r) => setTimeout(r, 30))

            // Create a child element inside Document B and append to host
            const childEl = docB.createElement('button')
            host.appendChild(childEl)

            // Resolve dependency from child element inside Document B
            const calc = await inject(calcToken)(childEl)
            const doubled = calc.double(21)

            return {
                doubled,
                childOwner: childEl.ownerDocument.title,
                hostOwner: host.ownerDocument.title,
            }
        })

        expect(result.doubled).toBe(42)
        expect(result.childOwner).toBe('Document B')
        expect(result.hostOwner).toBe('Document B')
    })
})
