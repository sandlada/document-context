import { describe, expect, it } from 'vitest'
import { createContext } from './context'
import { mount } from './mount'
import { pipe } from './pipe'
import { inject } from '../dom/inject'
import { provideClass, inject as injectDecorator } from './decorators'

describe('Decorators & Class Providers', () => {
    it('registers a class constructor via provideClass operator', () => {
        class GreeterService {
            greet(name: string) {
                return `Hello, ${name}!`
            }
        }

        const bp = pipe(
            createContext({}),
            provideClass('greeter', GreeterService)
        )

        const el = document.createElement('div')
        document.body.appendChild(el)
        const session = mount(bp)(el)

        const greeter = inject<GreeterService>('greeter')(session)
        expect(greeter).toBeInstanceOf(GreeterService)
        expect(greeter.greet('World')).toBe('Hello, World!')

        document.body.removeChild(el)
    })

    it('injects dependencies using getter decorator', () => {
        class AuthService {
            isAuthenticated() {
                return true
            }
        }

        const bp = pipe(
            createContext({}),
            provideClass('auth', AuthService)
        )

        const el = document.createElement('div')
        document.body.appendChild(el)
        mount(bp)(el)

        class ConsumerComponent {
            element: HTMLElement

            constructor(targetEl: HTMLElement) {
                this.element = targetEl
            }

            @injectDecorator('auth')
            get auth(): AuthService {
                return undefined as any
            }
        }

        const comp = new ConsumerComponent(el)
        expect(comp.auth).toBeDefined()
        expect(comp.auth.isAuthenticated()).toBe(true)

        document.body.removeChild(el)
    })
})
