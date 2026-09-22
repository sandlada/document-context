import { inject as injectService } from '../dom/inject'
import { withProvider } from './providers'
import type {
    IContextBlueprint,
    ISession,
    ServiceLifecycle,
    ServiceToken
} from './types'

/**
 * Any class constructor. Used as the `ClassConstructor` argument of
 * `provideClass`; instances are created as `new Ctor(session)`, so classes
 * receive their owning session on construction.
 */
export type Constructor<T = any> = new (...args: any[]) => T

/**
 * Pure Phase 1 operator that registers a class constructor as a service.
 *
 * Thin wrapper over `withProvider(token, (session) => new Ctor(session))`.
 * Prefer this over hand-written factories when the service is naturally a
 * class. For decorator style (`@provide` on the class plus lazy
 * `@inject`-decorated properties), see {@link provide} and
 * {@link injectDecorator}.
 *
 * Note: this module's decorator alias `inject` (re-exported as
 * `injectDecorator`) resolves services on class instances via
 * `this.element ?? this.target`, while `dom/inject`'s function-style
 * `inject(token)(elementOrSession)` resolves from an explicit target. They
 * share a name but take different targets; the decorator form is for class
 * bodies, the function form for everywhere else.
 *
 * @param token - Service identifier: string key or branded `ServiceToken`.
 * @param ClassConstructor - Class instantiated per lifecycle policy as
 * `new ClassConstructor(session)`.
 * @param options - Lifecycle (`singleton` / `scoped` / `transient`) and
 * `multi` flags. Defaults to `scoped`.
 * @returns A blueprint transformer registering the class provider.
 *
 * @example
 * ```ts
 * import { createContext, pipe, provideClass, mount, inject } from '@sandlada/document-context'
 *
 * class Logger {
 *     constructor(private session: unknown) {}
 *     log(msg: string) { console.log(msg) }
 * }
 * const blueprint = pipe(
 *     createContext({ count: 0 }),
 *     provideClass('logger', Logger, { lifecycle: 'singleton' })
 * )
 * const session = mount(blueprint)(document.getElementById('app')!)
 * inject('logger')(session)
 * ```
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
 * Class decorator that tags a class as the provider for a token.
 *
 * Attaches `__serviceToken` / `__serviceOptions` metadata to the constructor
 * without registering anything: pair it with a manual `withProvider(token,
 * (s) => new Target(s))` (or `provideClass`) that reads the metadata, or with
 * a framework integration that scans decorated classes. Does not instantiate
 * the class by itself.
 *
 * @param token - Service identifier the decorated class provides.
 * @param options - Lifecycle and `multi` flags recorded as metadata.
 * @returns A class decorator returning the (possibly augmented) constructor.
 *
 * @example
 * ```ts
 * import { provide } from '@sandlada/document-context'
 *
 * @provide('logger', { lifecycle: 'singleton' })
 * class Logger {}
 * ```
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
 * Property / accessor decorator that lazily resolves a service on each access.
 *
 * Supports two decorator protocols: legacy TypeScript experimental decorators
 * (`(target, propertyKey, descriptor?)`) and TC39 Stage 3 decorators
 * (`kind === 'field' | 'getter' | 'method' | 'accessor'`). In both cases the
 * installed getter resolves `inject(token)(host)` per access, where `host` is
 * `this.element ?? this.target ?? this`, so host-backed components (custom
 * elements, controllers) resolve against their own DOM scope. Resolution is
 * lazy and uncached: every property read re-runs injection.
 *
 * This is the class-body counterpart of function-style `dom/inject`, which
 * takes an explicit `(elementOrSession)` target instead of `this`.
 *
 * @param token - Service identifier to resolve on each access.
 * @returns A decorator compatible with legacy and TC39 Stage 3 runtimes.
 *
 * @example
 * ```ts
 * import { injectDecorator } from '@sandlada/document-context'
 *
 * class MyPanel {
 *     element!: HTMLElement
 *     @injectDecorator('logger')
 *     declare logger: ConsoleLogger
 * }
 * ```
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

/**
 * Decorator-form alias of {@link injectDecorator}, exported under the familiar
 * `inject` name for class bodies.
 *
 * Distinct from function-style `dom/inject` (`inject(token)(elementOrSession)`):
 * this alias takes no explicit target and instead resolves against
 * `this.element ?? this.target ?? this` on each property access. Use this
 * alias inside classes, the `dom/inject` function everywhere else.
 *
 * @example
 * ```ts
 * import { inject } from '@sandlada/document-context/core'
 *
 * class MyPanel {
 *     element!: HTMLElement
 *     @inject('logger')
 *     declare logger: ConsoleLogger
 * }
 * ```
 */
export { injectDecorator as inject }
