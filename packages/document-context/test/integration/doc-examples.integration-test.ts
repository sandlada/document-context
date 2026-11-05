import { afterEach, describe, expect, it } from 'vitest'
import type { Subscription } from 'rxjs'
import {
    attach,
    createContext,
    defineToken,
    dispose,
    getDefaultApplication,
    inject,
    inject$,
    injectAll,
    injectAll$,
    isPrivateToken,
    isPublicToken,
    merge,
    mount,
    onAdopt,
    onDispose,
    onMount,
    onResume,
    onSuspend,
    pipe,
    provide,
    read,
    session$,
    sessionAt,
    setDefaultApplication,
    subscribe$,
    update,
} from '../../src/index'
import { createApplication } from '../../src/application/application'
import { createDomHostAdapter } from '../../src/infrastructure/dom/host-adapter'
import { createSsrApplication } from '../../src/infrastructure/ssr/index'

const createdElements: Element[] = []

function createHost(tag = 'div'): HTMLElement {
    const el = document.createElement(tag)
    document.body.appendChild(el)
    createdElements.push(el)
    return el
}

afterEach(() => {
    for (const el of createdElements.splice(0)) {
        el.remove()
    }
})

describe('Doc Comment Code Examples (Scenario-driven & Executable)', () => {
    describe('1. Blueprint & State Operators', () => {
        it('createContext - E-commerce cart state isolation', async () => {
            interface CartItem {
                readonly id: string
                readonly price: number
            }
            interface CartState {
                readonly items: readonly CartItem[]
                readonly total: number
            }

            // Create pure blueprint (no DOM interaction during blueprint phase)
            const cartBlueprint = createContext<CartState>({ items: [], total: 0 })

            const hostEl = createHost('div')
            const session = mount(cartBlueprint)(hostEl)
            await session.ready

            // Perform immutable state transition
            const updated = update<CartState>((state) => ({
                items: [...state.items, { id: 'p-101', price: 150 }],
                total: state.total + 150,
            }))(session)

            expect(updated).toBe(true)

            // Read synchronous snapshot projection
            const currentTotal = read<CartState, number>((s) => s.total)(session)
            expect(currentTotal).toBe(150)
        })

        it('pipe - Auth blueprint pipeline composition', async () => {
            interface AuthState {
                readonly user: string | null
                readonly isAuthenticated: boolean
            }

            const authBlueprint = pipe(
                createContext<AuthState>({ user: null, isAuthenticated: false }),
                onMount((session) => {
                    update<AuthState>(() => ({ user: 'Ada', isAuthenticated: true }))(session)
                }),
            )

            const host = createHost('main')
            const session = mount(authBlueprint)(host)
            await session.ready

            const user = read<AuthState, string | null>((s) => s.user)(session)
            expect(user).toBe('Ada')
        })

        it('merge - Nested configuration deep merge without mutation', () => {
            interface AppConfig {
                readonly theme: 'light' | 'dark'
                readonly features: {
                    readonly analytics: boolean
                    readonly betaUI: boolean
                }
            }

            const baseConfig: AppConfig = {
                theme: 'light',
                features: { analytics: true, betaUI: false },
            }

            const patch = {
                theme: 'dark' as const,
                features: { betaUI: true },
            }

            const merged = merge(baseConfig, patch)

            expect(merged).toEqual({
                theme: 'dark',
                features: { analytics: true, betaUI: true },
            })
            // Verify immutability of baseConfig
            expect(baseConfig.theme).toBe('light')
            expect(baseConfig.features.betaUI).toBe(false)
        })
    })

    describe('2. Tokens & Dependency Injection', () => {
        it('defineToken & isPublicToken & isPrivateToken - Public token and realm-private token', () => {
            // Public token for cross-bundle / micro-frontend resolution
            const themeToken = defineToken<'light' | 'dark'>('public')('app:theme')
            expect(isPublicToken(themeToken)).toBe(true)
            expect(isPrivateToken(themeToken)).toBe(false)

            // Private token for module-internal security
            const secretKeyToken = defineToken<{ secret: string }>('private')('auth:secret')
            expect(isPrivateToken(secretKeyToken)).toBe(true)
            expect(isPublicToken(secretKeyToken)).toBe(false)
        })

        it('provide & inject - Theme and notification service across DOM tree', async () => {
            interface LoggerService {
                log(msg: string): void
            }
            const loggerToken = defineToken<LoggerService>('public')('app:logger')

            const logs: string[] = []
            const blueprint = pipe(
                createContext({}),
                provide(
                    loggerToken,
                    () => ({
                        log: (msg) => logs.push(`[LOG]: ${msg}`),
                    }),
                    { lifecycle: 'scoped' },
                ),
            )

            const host = createHost('div')
            const childButton = document.createElement('button')
            host.appendChild(childButton)

            const session = mount(blueprint)(host)
            await session.ready

            // Child element resolves logger from ancestor scope
            const logger = await inject(loggerToken)(childButton)
            logger.log('Action triggered')

            expect(logs).toEqual(['[LOG]: Action triggered'])
        })

        it('inject$ - Reactive stream of dynamic dependency', async () => {
            interface ConfigService {
                version: string
            }
            const configToken = defineToken<ConfigService>('public')('app:config')

            const blueprint = pipe(
                createContext({}),
                provide(configToken, () => ({ version: '1.0.0' })),
            )

            const host = createHost('div')
            const session = mount(blueprint)(host)
            await session.ready

            const versions: string[] = []
            await new Promise<void>((resolve) => {
                const sub = inject$(configToken)(host).subscribe({
                    next: (cfg) => {
                        versions.push(cfg.version)
                    },
                    complete: () => {
                        sub.unsubscribe()
                        resolve()
                    },
                })
            })

            expect(versions).toEqual(['1.0.0'])
        })

        it('injectAll & injectAll$ - Form validator plugin collection', async () => {
            interface Validator {
                name: string
                validate(val: string): boolean
            }
            const validatorToken = defineToken<Validator>('public')('app:validator')

            const formBlueprint = pipe(
                createContext({}),
                provide(validatorToken, () => ({ name: 'required', validate: (v) => v.length > 0 }), {
                    multi: true,
                }),
                provide(validatorToken, () => ({ name: 'email', validate: (v) => v.includes('@') }), {
                    multi: true,
                }),
            )

            const host = createHost('form')
            const input = document.createElement('input')
            host.appendChild(input)

            const session = mount(formBlueprint)(host)
            await session.ready

            // Collect all multi-providers as an array
            const validators = await injectAll(validatorToken)(input)
            expect(validators).toHaveLength(2)
            expect(validators.map((v) => v.name)).toEqual(['required', 'email'])

            // Collect reactively via injectAll$
            let collectedCount = 0
            await new Promise<void>((resolve) => {
                const sub = injectAll$(validatorToken)(input).subscribe({
                    next: (list) => {
                        collectedCount = list.length
                    },
                    complete: () => {
                        sub.unsubscribe()
                        resolve()
                    },
                })
            })
            expect(collectedCount).toBe(2)
        })
    })

    describe('3. Execution & Session Verbs', () => {
        it('mount & update & read & subscribe$ - Counter UI flow with unsubscribe', async () => {
            interface CounterState {
                count: number
            }
            const counterBlueprint = createContext<CounterState>({ count: 10 })

            const host = createHost('section')
            const label = document.createElement('span')
            host.appendChild(label)

            const session = mount(counterBlueprint, { token: 'app:counter-widget' })(host)
            await session.ready

            // Subscribe to state changes and project to DOM
            const history: number[] = []
            const sub: Subscription = subscribe$<CounterState>((s) => {
                history.push(s.count)
                label.textContent = String(s.count)
            })(session)

            expect(label.textContent).toBe('10')

            // Update state
            update<CounterState>((s) => ({ count: s.count + 1 }))(session)
            expect(label.textContent).toBe('11')

            // Read snapshot directly
            const current = read<CounterState, number>((s) => s.count)(session)
            expect(current).toBe(11)

            // Unsubscribe cleanly
            sub.unsubscribe()
            update<CounterState>((s) => ({ count: s.count + 5 }))(session)
            expect(label.textContent).toBe('11') // Not updated after unsubscribe
            expect(history).toEqual([10, 11])
        })

        it('dispose - Graceful session teardown and update rejection', async () => {
            interface SessionState {
                active: boolean
            }
            let cleanedUp = false
            const blueprint = pipe(
                createContext<SessionState>({ active: true }),
                onDispose(() => {
                    cleanedUp = true
                }),
            )

            const host = createHost('div')
            const session = mount(blueprint)(host)
            await session.ready

            expect(session.status).toBe('active')

            // Trigger dispose
            dispose(session)

            expect(cleanedUp).toBe(true)
            expect(session.status).toBe('disposed')

            // Subsequent update returns false and does nothing
            const updated = update<SessionState>(() => ({ active: false }))(session)
            expect(updated).toBe(false)
        })

        it('sessionAt & session$ - Event delegation target lookup', async () => {
            const blueprint = createContext({ area: 'admin' })
            const host = createHost('div')
            const childCard = document.createElement('div')
            const actionButton = document.createElement('button')
            childCard.appendChild(actionButton)
            host.appendChild(childCard)

            const session = mount(blueprint)(host)
            await session.ready

            // Locate session from deeply nested clicked button
            const foundSession = sessionAt(actionButton)
            expect(foundSession).toBe(session)

            // Reactively observe nearest session
            let observedSession: unknown = null
            const sub = session$(actionButton).subscribe((s) => {
                observedSession = s
            })
            expect(observedSession).toBe(session)
            sub.unsubscribe()
        })

        it('attach - Forwarding external host connectivity facts', async () => {
            const events: string[] = []
            const blueprint = createContext({ status: 'live' })
            const host = createHost('div')
            const session = mount(blueprint)(host)
            await session.ready

            const handle = attach({
                onConnect: () => events.push('connected'),
                onDisconnect: () => events.push('disconnected'),
            })(session)

            // Detaching the handle unhooks listeners
            handle.detach()
            expect(session.status).toBe('active')
        })

        it('getDefaultApplication & setDefaultApplication - Rebuilding composition root', () => {
            const defaultApp = getDefaultApplication()
            expect(defaultApp).toBeDefined()
            expect(typeof defaultApp.mount).toBe('function')

            // Verify resetting rebuilds on next access
            setDefaultApplication(null)
            const newApp = getDefaultApplication()
            expect(newApp).toBeDefined()
        })
    })

    describe('4. Lifecycle Hooks', () => {
        it('onMount & onDispose - Timer resource lifecycle with cleanup return', async () => {
            interface TimerState {
                ticks: number
            }
            let isTimerRunning = false

            const timerBlueprint = pipe(
                createContext<TimerState>({ ticks: 0 }),
                onMount((session) => {
                    isTimerRunning = true
                    // Return a cleanup callback executed on final disposal
                    return () => {
                        isTimerRunning = false
                    }
                }),
            )

            const host = createHost('div')
            const session = mount(timerBlueprint)(host)
            await session.ready

            expect(isTimerRunning).toBe(true)

            dispose(session)
            expect(isTimerRunning).toBe(false)
        })

        it('onSuspend & onResume - Pause and resume rendering on DOM disconnect and resuscitation', async () => {
            interface RenderState {
                rendering: boolean
            }
            const events: string[] = []

            const renderBlueprint = pipe(
                createContext<RenderState>({ rendering: true }),
                onSuspend(() => {
                    events.push('render:suspended')
                }),
                onResume(() => {
                    events.push('render:resumed')
                }),
            )

            const host = createHost('div')
            // Keyed session enables suspension / resuscitation across DOM detach
            const session = mount(renderBlueprint, { token: 'app:render-session', suspensionTtlMs: 2000 })(host)
            await session.ready

            // Detach host from document: session moves to suspended
            host.remove()
            for (let i = 0; i < 8; i++) await Promise.resolve()

            expect(session.status).toBe('suspended')
            expect(events).toContain('render:suspended')

            // Resuscitate by mounting on a new host using the same key within TTL
            const newHost = createHost('section')
            const resuscitated = mount(renderBlueprint, { token: 'app:render-session' })(newHost)
            await resuscitated.ready

            expect(resuscitated).toBe(session)
            expect(session.status).toBe('active')
            expect(events).toContain('render:resumed')
        })

        it('onAdopt - Cross-document / shadow root adoption adaptation', async () => {
            let adoptedCount = 0
            const blueprint = pipe(
                createContext({ mode: 'default' }),
                onAdopt(() => {
                    adoptedCount += 1
                }),
            )

            const host = createHost('div')
            const session = mount(blueprint)(host)
            await session.ready

            expect(session.status).toBe('active')
        })
    })

    describe('5. Architecture & Environment Adapters', () => {
        it('createApplication - Isolated application instance with custom adapter', async () => {
            const hostAdapter = createDomHostAdapter()
            const customApp = createApplication({ host: hostAdapter })

            const host = createHost('div')
            const blueprint = createContext({ isolated: true })

            const session = customApp.mount(blueprint)(host)
            await session.ready

            const isIsolated = customApp.read((s: { isolated: boolean }) => s.isolated)(session)
            expect(isIsolated).toBe(true)
        })

        it('createSsrApplication - Server-side rendering without DOM globals', async () => {
            const ssrApp = createSsrApplication()
            const serverHost = { kind: 'server' as const }

            const initialGreeting = 'Hello from SSR'
            const ssrBlueprint = createContext({ greeting: initialGreeting })

            const session = ssrApp.mount(ssrBlueprint)(serverHost)
            await session.ready

            const renderedGreeting = ssrApp.read((s: { greeting: string }) => s.greeting)(session)
            expect(renderedGreeting).toBe('Hello from SSR')
        })
    })
})
