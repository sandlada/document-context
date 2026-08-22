// 品牌化 Token
declare const ServiceTokenBrand: unique symbol

export interface ServiceToken<T, Name extends string = string> {
    readonly [ServiceTokenBrand]: true
    readonly name: Name
    readonly __type?: T
}

/**
 * Creates a branded ServiceToken for type-safe dependency injection.
 */
export function createToken<T, Name extends string = string>(name: Name): ServiceToken<T, Name> {
    return { name } as ServiceToken<T, Name>
}

// 服務生命週期
export type ServiceLifecycle = 'singleton' | 'scoped' | 'transient'

// 服務註冊記錄 (內部純資料結構)
export interface IServiceRegistration<T = unknown> {
    readonly token: string | ServiceToken<T>
    readonly factory: (session: ISession<any, any>) => T | Promise<T>
    readonly lifecycle: ServiceLifecycle
    readonly isAsync: boolean
    readonly multi?: boolean | undefined
}

// 橋接屬性規則
export interface IBridgePropertyRule<S = any> {
    readonly target: string
    readonly parse?: ((domValue: string) => any) | undefined
    readonly transform?: ((stateValue: any) => string | boolean | number | null) | undefined
    readonly event?: string | undefined
}

// 橋接配置
export interface IBridgeOptions<S = any> {
    readonly properties: {
        readonly [K in keyof S]?: string | IBridgePropertyRule<S> | undefined
    }
    readonly events?: readonly string[] | undefined
    readonly batch?: boolean | undefined
    readonly conflict?: ('lastWriteWins' | 'statePrecedence' | 'domPrecedence') | undefined
    readonly activeElementGuard?: boolean | undefined
}

// 存儲水合策略
export type HydrationStrategy = 'storageFirst' | 'domFirst' | 'blueprintFirst' | 'merge'

// 同步存儲適配器
export interface IStorageAdapter<S = any> {
    getItem(key: string): string | null | S
    setItem(key: string, value: string | S): void
    removeItem(key: string): void
}

// 非同步存儲適配器
export interface IAsyncStorageAdapter<S = any> {
    getItem(key: string): Promise<string | null | S>
    setItem(key: string, value: string | S): Promise<void>
    removeItem(key: string): Promise<void>
}

// 存儲配置
export interface IStorageOptions<S = any> {
    readonly adapter: 'localStorage' | 'sessionStorage' | IStorageAdapter<S> | IAsyncStorageAdapter<S>
    readonly key: string
    readonly hydrationStrategy?: HydrationStrategy | undefined
    readonly crossTabSync?: boolean | undefined
    readonly version?: number | undefined
    readonly migrate?: ((persistedState: unknown, oldVersion: number) => Partial<S>) | undefined
}

// 生命週期鉤子配置
export type HookCleanup = void | (() => void)

export interface ILifecycleHooks<
    S extends Record<PropertyKey, any> = Record<PropertyKey, any>,
    Services = {}
> {
    readonly mount?: ((session: ISession<S, Services>) => HookCleanup | Promise<HookCleanup>) | undefined
    readonly dispose?: ((session: ISession<S, Services>) => void | Promise<void>) | undefined
    readonly suspend?: ((session: ISession<S, Services>) => void) | undefined
    readonly resuscitate?: ((session: ISession<S, Services>, newTarget: HTMLElement) => void) | undefined
    readonly adopt?: ((session: ISession<S, Services>, newDocument: Document) => void) | undefined
}

export type LifecycleEventName = keyof ILifecycleHooks

export interface ILifecycleHookRegistration<
    S extends Record<PropertyKey, any> = Record<PropertyKey, any>,
    Services = {}
> {
    readonly event: LifecycleEventName
    readonly handler: Function
}

// 藍圖介面 (100% 純不可變結構，結構共享)
export interface IContextBlueprint<
    S extends Record<PropertyKey, any> = Record<PropertyKey, any>,
    Services = {}
> {
    readonly initialState: Readonly<S>
    readonly providers: ReadonlyMap<string | ServiceToken<any>, IServiceRegistration<any>>
    readonly bridges: ReadonlyArray<IBridgeOptions<S>>
    readonly storage?: Readonly<IStorageOptions<S>> | undefined
    readonly hooks: ReadonlyArray<ILifecycleHookRegistration<S, Services>>
}

// 執行期會話介面 (不透明句柄)
declare const SessionBrand: unique symbol

export interface ISession<
    S extends Record<PropertyKey, any> = Record<PropertyKey, any>,
    Services = {}
> {
    readonly [SessionBrand]: true
    readonly target: HTMLElement
    readonly blueprint: IContextBlueprint<S, Services>
    readonly abortSignal: AbortSignal
    readonly isDisposed: boolean
    readonly [Symbol.dispose]: () => void
    readonly [Symbol.asyncDispose]: () => Promise<void>
}

// ServiceRegistry 全域介面聲明合併存根 (用於 TypeScript 聲明合併)
export interface ServiceRegistry {}
