import { inject as injectService } from '../dom/inject'
import { withProvider } from './providers'
import type {
    IContextBlueprint,
    ISession,
    ServiceLifecycle,
    ServiceToken
} from './types'

export type Constructor<T = any> = new (...args: any[]) => T

/**
 * Pure blueprint operator to register a class constructor as a service provider.
 *
 * @param token Service identifier.
 * @param ClassConstructor Constructor function.
 * @param options Lifecycle configuration options.
 * @returns Higher-order blueprint operator.
 */
export function provideClass<
    K extends string | ServiceToken<any>,
    T,
    S extends Record<PropertyKey, any>,
    ExistingServices
>(
    token: K,
    ClassConstructor: Constructor<T>,
    options?: { lifecycle?: ServiceLifecycle; multi?: boolean }
): (blueprint: IContextBlueprint<S, ExistingServices>) => IContextBlueprint<S, any> {
    return withProvider(
        token,
        (session: ISession<S, ExistingServices>) => new ClassConstructor(session),
        options
    )
}

/**
 * Class decorator to mark a class as a service provider.
 */
export function provide<K extends string | ServiceToken<any>>(
    token: K,
    options?: { lifecycle?: ServiceLifecycle; multi?: boolean }
) {
    return function <T extends Constructor>(target: T): T {
        ;(target as any).__serviceToken = token
        ;(target as any).__serviceOptions = options
        return target
    }
}

/**
 * Property / accessor / getter decorator to automatically resolve a service on a class instance.
 */
export function injectDecorator<K extends string | ServiceToken<any>>(token: K) {
    return function (target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor): any {
        // 1. TypeScript Experimental Method / Accessor Decorator
        if (typeof propertyKey === 'string' || typeof propertyKey === 'symbol') {
            const getter = function (this: any) {
                const host = this.element ?? this.target ?? this
                return injectService(token as any)(host)
            }

            if (descriptor) {
                descriptor.get = getter
                delete (descriptor as any).value
                delete (descriptor as any).writable
                return descriptor
            }

            Object.defineProperty(target, propertyKey, {
                get: getter,
                enumerable: true,
                configurable: true
            })
            return
        }

        // 2. TC39 Stage 3 Decorators (Context Object)
        if (target && typeof target === 'object' && 'kind' in target) {
            const context = target
            const getter = function (this: any) {
                const host = this.element ?? this.target ?? this
                return injectService(token as any)(host)
            }

            if (context.kind === 'getter' || context.kind === 'method' || context.kind === 'accessor') {
                return getter
            }

            if (context.kind === 'field' && typeof context.addInitializer === 'function') {
                context.addInitializer(function (this: any) {
                    Object.defineProperty(this, context.name, {
                        get: getter,
                        enumerable: true,
                        configurable: true
                    })
                })
            }
        }

        return target
    }
}

export { injectDecorator as inject }
