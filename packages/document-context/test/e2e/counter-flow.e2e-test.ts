import { afterEach, describe, expect, it } from 'vitest'
import { createContext, pipe } from '../../src/domain/model/blueprint'
import { defineToken } from '../../src/domain/model/token'
import { createApplication } from '../../src/application/application'
import { provide } from '../../src/application/api/provide'
import { onDispose, onMount } from '../../src/application/api/hooks'
import { createDomHostAdapter } from '../../src/infrastructure/dom/host-adapter'

interface CounterState {
    count: number
}

interface CounterService {
    inc(): void
}

const counterToken = defineToken<CounterService>('public')('app:counter')

const created: Element[] = []

function element(tag = 'div'): Element {
    const node = document.createElement(tag)
    document.body.appendChild(node)
    created.push(node)
    return node
}

afterEach(() => {
    for (const node of created.splice(0)) {
        node.remove()
    }
})

describe('counter flow', () => {
    it('[API #9] 掛載 → 注入 → 更新 → DOM 反映 → 銷毀', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })

        const host = element('section')
        const output = element('output')
        const button = element('button')
        host.appendChild(output)
        host.appendChild(button)

        const disposed: string[] = []

        const counterSession = app.mount(
            pipe(
                createContext<CounterState>({ count: 0 }),
                provide(counterToken, ({ session }) => ({
                    inc: () => {
                        app.update<CounterState>((state) => ({
                            count: state.count + 1,
                        }))(session)
                    },
                })),
                onMount((session) => {
                    // 本庫不代寫 DOM：使用者自己把狀態畫出來。
                    const subscription = app.subscribe$<CounterState>((state) => {
                        output.textContent = String(state.count)
                    })(session)
                    return () => {
                        subscription.unsubscribe()
                    }
                }),
                onDispose(() => {
                    disposed.push('dispose')
                }),
            ),
        )(host)
        await counterSession.ready

        expect(output.textContent).toBe('0')

        // 消費端是另一個會話，掛在同一個宿主鏈上。
        const consumerSession = app.mount(pipe(createContext({})))(button)
        await consumerSession.ready

        const counter = await app.inject(counterToken)(button)
        counter.inc()

        expect(output.textContent).toBe('1')
        expect(app.read<CounterState, number>((state) => state.count)(counterSession)).toBe(1)

        app.dispose(counterSession)

        expect(disposed).toEqual(['dispose'])
        expect(counterSession.status).toBe('disposed')

        // 銷毀後的 update 不再改變狀態。
        app.update<CounterState>((state) => ({ count: state.count + 1 }))(counterSession)
        expect(app.read<CounterState, number>((state) => state.count)(counterSession)).toBe(1)
    })

    it('[API #3] 按鈕事件透過 host.on 觸發狀態更新', async () => {
        const adapter = createDomHostAdapter()
        const app = createApplication({ host: adapter })

        const host = element('section')
        const button = element('button')
        host.appendChild(button)

        const session = app.mount(
            pipe(
                createContext<CounterState>({ count: 0 }),
                provide(counterToken, ({ session }) => ({
                    inc: () => {
                        app.update<CounterState>((state) => ({
                            count: state.count + 1,
                        }))(session)
                    },
                })),
            ),
        )(host)
        await session.ready

        const counter = await app.inject(counterToken)(button)
        const stop = session.host.on('click', () => {
            counter.inc()
        })
        button.dispatchEvent(new Event('click', { bubbles: true }))

        expect(app.read<CounterState, number>((state) => state.count)(session)).toBe(1)

        stop()
        button.dispatchEvent(new Event('click', { bubbles: true }))

        expect(app.read<CounterState, number>((state) => state.count)(session)).toBe(1)
    })

    it('verifies counter demo page flow using package exports', async () => {
        const { createContext, dispose, mount, onMount, pipe, subscribe$, update } = await import('../../src/index.js')

        const container = element('div')
        container.innerHTML = `
            <div id="counter-box">
                <p>count: <strong id="count">…</strong> (double: <span id="double">…</span>)</p>
                <button id="inc" type="button">+1</button>
                <button id="dec" type="button">−1</button>
                <button id="reset" type="button">reset</button>
                <button id="dispose" type="button">dispose</button>
            </div>
            <ul id="log"></ul>
        `

        const logs: string[] = []
        const log = (msg: string): void => {
            logs.push(msg)
        }

        const blueprint = pipe(
            createContext({ count: 0 }),
            onMount(() => {
                log('mounted')
            }),
        )

        const counterBox = container.querySelector('#counter-box')!
        const session = mount(blueprint)(counterBox)
        await session.ready

        const countEl = container.querySelector('#count')!
        const doubleEl = container.querySelector('#double')!

        const sub = subscribe$<{ count: number }>((state) => {
            countEl.textContent = String(state.count)
            doubleEl.textContent = String(state.count * 2)
            log(`state: ${JSON.stringify(state)}`)
        })(session)

        expect(countEl.textContent).toBe('0')
        expect(doubleEl.textContent).toBe('0')
        expect(logs).toContain('mounted')

        // Inc
        update<{ count: number }>((s) => ({ count: s.count + 1 }))(session)
        expect(countEl.textContent).toBe('1')
        expect(doubleEl.textContent).toBe('2')

        // Dec
        update<{ count: number }>((s) => ({ count: s.count - 1 }))(session)
        expect(countEl.textContent).toBe('0')
        expect(doubleEl.textContent).toBe('0')

        // Reset
        update<{ count: number }>(() => ({ count: 0 }))(session)
        expect(countEl.textContent).toBe('0')

        // Dispose
        dispose(session)
        expect(session.status).toBe('disposed')
        sub.unsubscribe()
    })

    it('verifies di demo page flow using package exports', async () => {
        const { createContext, defineToken, inject, mount, pipe, provide } = await import('../../src/index.js')

        const container = element('div')
        container.innerHTML = `
            <div id="app-scope">
                <section id="inherited-box">
                    <h2>inherited</h2>
                    <p>resolved logger: <code id="inherited-out">…</code></p>
                </section>
                <section id="override-box">
                    <h2>override</h2>
                    <p>resolved logger: <code id="override-out">…</code></p>
                </section>
            </div>
        `

        const loggerToken = defineToken<{ prefix: string }>('public')('demo:logger')

        const appBlueprint = pipe(
            createContext({ scope: 'app' }),
            provide(loggerToken, () => ({ prefix: '[app]' })),
        )
        const plainBlueprint = pipe(createContext({ scope: 'plain' }))
        const overrideBlueprint = pipe(
            createContext({ scope: 'override' }),
            provide(loggerToken, () => ({ prefix: '[section]' })),
        )

        const appScope = container.querySelector('#app-scope')!
        const inheritedBox = container.querySelector('#inherited-box')!
        const overrideBox = container.querySelector('#override-box')!

        const appSession = mount(appBlueprint)(appScope)
        const plainSession = mount(plainBlueprint)(inheritedBox)
        const overrideSession = mount(overrideBlueprint)(overrideBox)
        await Promise.all([appSession.ready, plainSession.ready, overrideSession.ready])

        const inherited = await inject(loggerToken)(inheritedBox)
        expect(inherited.prefix).toBe('[app]')

        const overridden = await inject(loggerToken)(overrideBox)
        expect(overridden.prefix).toBe('[section]')
    })

    it('verifies late-binding demo page flow using package exports', async () => {
        const { createContext, defineToken, inject, mount, pipe, provide } = await import('../../src/index.js')

        const container = element('div')
        container.innerHTML = `
            <div id="late-parent">
                <p>status: <strong id="status">waiting for provider…</strong></p>
                <p>greeter says: <code id="greeting">…</code></p>
                <button id="mount-now" type="button">mount provider now</button>
                <span id="late-child"></span>
            </div>
        `

        interface Greeter {
            greet(name: string): string
        }
        const greeterToken = defineToken<Greeter>('public')('demo:greeter')

        const blueprint = pipe(
            createContext({ scope: 'late' }),
            provide(greeterToken, () => ({ greet: (name: string) => `hello, ${name}!` })),
        )

        const lateChild = container.querySelector('#late-child')!
        const lateParent = container.querySelector('#late-parent')!

        const pending = inject(greeterToken)(lateChild)

        const session = mount(blueprint)(lateParent)
        await session.ready

        const greeter = await pending
        expect(greeter.greet('world')).toBe('hello, world!')
    })
})
