import { describe, expect, it } from 'vitest'
import { createContext } from '../core/context'
import { withProvider } from '../core/providers'
import { withAsyncProvider } from '../core/async-provider'
import { mount } from '../core/mount'
import { pipe } from '../core/pipe'
import { injectAll, injectAllAsync } from './inject-all'

describe('injectAll & injectAllAsync multi-provider collection protocol', () => {
    it('collects providers across multiple ancestor levels using bottomUp order by default', () => {
        const rootEl = document.createElement('div')
        const midEl = document.createElement('div')
        const childEl = document.createElement('span')

        rootEl.appendChild(midEl)
        midEl.appendChild(childEl)
        document.body.appendChild(rootEl)

        const rootBp = pipe(
            createContext({}),
            withProvider('interceptor', () => 'root-interceptor', { multi: true })
        )
        const midBp = pipe(
            createContext({}),
            withProvider('interceptor', () => 'mid-interceptor', { multi: true })
        )

        mount(rootBp)(rootEl)
        mount(midBp)(midEl)

        const list = injectAll<string>('interceptor')(childEl)
        expect(list).toEqual(['mid-interceptor', 'root-interceptor'])

        document.body.removeChild(rootEl)
    })

    it('supports topDown ordering when configured', () => {
        const rootEl = document.createElement('div')
        const midEl = document.createElement('div')
        const childEl = document.createElement('span')

        rootEl.appendChild(midEl)
        midEl.appendChild(childEl)
        document.body.appendChild(rootEl)

        const rootBp = pipe(
            createContext({}),
            withProvider('plugin', () => 'root-plugin', { multi: true })
        )
        const midBp = pipe(
            createContext({}),
            withProvider('plugin', () => 'mid-plugin', { multi: true })
        )

        mount(rootBp)(rootEl)
        mount(midBp)(midEl)

        const list = injectAll<string>('plugin', { direction: 'topDown' })(childEl)
        expect(list).toEqual(['root-plugin', 'mid-plugin'])

        document.body.removeChild(rootEl)
    })

    it('resolves async multi-providers concurrently with injectAllAsync', async () => {
        const rootEl = document.createElement('div')
        const childEl = document.createElement('div')
        rootEl.appendChild(childEl)
        document.body.appendChild(rootEl)

        const rootBp = pipe(
            createContext({}),
            withAsyncProvider('async-plugin', async () => {
                await new Promise((r) => setTimeout(r, 10))
                return 'async-root'
            }, { multi: true })
        )

        mount(rootBp)(rootEl)

        const result = await injectAllAsync<string>('async-plugin')(childEl)
        expect(result).toEqual(['async-root'])

        document.body.removeChild(rootEl)
    })
})
