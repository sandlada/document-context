import { describe, expect, it } from 'vitest'
import {
    createToken,
    type IBridgeOptions,
    type IContextBlueprint,
    type ILifecycleHooks,
    type ISession,
    type IStorageOptions,
    type ServiceLifecycle,
    type ServiceToken
} from './types'

describe('Core Types & Helpers', () => {
    it('createToken should create a branded token with name', () => {
        interface CustomService {
            log(msg: string): void
        }

        const token = createToken<CustomService>('custom-logger')
        expect(token.name).toBe('custom-logger')
        expect(typeof token).toBe('object')
    })

    it('should satisfy ISession and IContextBlueprint type structures', () => {
        type State = {
            count: number
        }

        const blueprint: IContextBlueprint<State> = {
            initialState: { count: 0 },
            providers: new Map(),
            bridges: [],
            hooks: []
        }

        expect(blueprint.initialState.count).toBe(0)
        expect(blueprint.providers.size).toBe(0)
        expect(blueprint.bridges.length).toBe(0)
        expect(blueprint.hooks.length).toBe(0)
    })

    it('should allow valid lifecycle types and storage options', () => {
        const lifecycles: ServiceLifecycle[] = ['singleton', 'scoped', 'transient']
        expect(lifecycles).toContain('singleton')
        expect(lifecycles).toContain('scoped')
        expect(lifecycles).toContain('transient')

        const storageOpts: IStorageOptions<{ theme: string }> = {
            adapter: 'localStorage',
            key: 'test-app',
            hydrationStrategy: 'storageFirst',
            crossTabSync: true,
            version: 1
        }
        expect(storageOpts.adapter).toBe('localStorage')
        expect(storageOpts.key).toBe('test-app')
    })

    it('should allow valid bridge options and lifecycle hooks', () => {
        const bridgeOpts: IBridgeOptions<{ count: number }> = {
            properties: {
                count: {
                    target: 'dataset.count',
                    parse: (v) => Number(v),
                    transform: (v) => String(v)
                }
            },
            batch: true
        }
        expect(bridgeOpts.batch).toBe(true)

        const hooks: ILifecycleHooks<{ count: number }> = {
            mount: (_session) => {
                return () => {}
            },
            dispose: (_session) => {}
        }
        expect(typeof hooks.mount).toBe('function')
        expect(typeof hooks.dispose).toBe('function')
    })
})
