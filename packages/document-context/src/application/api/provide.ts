/**
 * `provide` — the blueprint operator that registers a dependency.
 *
 * The operator is pure: it appends a registration to the blueprint and returns a new blueprint. It
 * never runs the factory and never touches the DOM.
 */

import type {
    Blueprint,
    BlueprintOperator,
    Factory,
    ProviderLifecycle,
    ProviderRegistration,
} from '../../domain/model/blueprint'
import type { TokenLike } from '../../domain/model/token'
import { assertResolvableToken } from '../../domain/model/token'

export interface ProvideOptions {
    /**
     * Caching behaviour of the provided value.
     *
     * - `scoped` (default): one instance per session.
     * - `singleton`: one instance per application; the first registration wins.
     * - `transient` / `prototype`: a new instance on every injection.
     */
    readonly lifecycle?: ProviderLifecycle
    /** Run the factory during initialization instead of on the first injection. */
    readonly eager?: boolean
    /** Make the registration collectable by `injectAll` / `injectAll$`. */
    readonly multi?: boolean
    /** Tokens that are created before this factory runs. */
    readonly uses?: readonly TokenLike<any>[]
}

/**
 * Register a dependency on a blueprint.
 *
 * @example
 * ```ts
 * import { createContext, defineToken, pipe, provide, mount, inject } from '@sandlada/document-context'
 *
 * interface LoggerService {
 *     log(msg: string): void
 * }
 * const loggerToken = defineToken<LoggerService>('public')('app:logger')
 *
 * // Register scoped dependency with access to session tools
 * const blueprint = pipe(
 *     createContext({ count: 0 }),
 *     provide(
 *         loggerToken,
 *         ({ session }) => ({
 *             log: (msg) => console.log(`[Session ${session.status}]: ${msg}`),
 *         }),
 *         { lifecycle: 'scoped' },
 *     ),
 * )
 *
 * const host = document.getElementById('app-root')!
 * const session = mount(blueprint)(host)
 * await session.ready
 *
 * const logger = await inject(loggerToken)(host)
 * logger.log('Service initialized successfully')
 * ```
 *
 * @param token - The token to answer to.
 * @param factory - The factory creating the value. May return a promise.
 * @param options - Lifecycle, eagerness, multiplicity and declared dependencies.
 * @returns A blueprint operator.
 */
export function provide<T>(
    token: TokenLike<T>,
    factory: Factory<T>,
    options?: ProvideOptions,
): BlueprintOperator<any> {
    assertResolvableToken(token)
    for (const used of options?.uses ?? []) {
        assertResolvableToken(used)
    }
    const registration: ProviderRegistration = {
        token: token as TokenLike,
        factory: factory as Factory<unknown>,
        lifecycle: options?.lifecycle ?? 'scoped',
        eager: options?.eager ?? false,
        multi: options?.multi ?? false,
        uses: options?.uses ? [...options.uses] : [],
        order: -1,
    }
    return (blueprint: Blueprint<any>): Blueprint<any> => {
        const ordered: ProviderRegistration = { ...registration, order: blueprint.providers.length }
        return Object.freeze({
            state: blueprint.state,
            providers: Object.freeze([...blueprint.providers, ordered]),
            hooks: blueprint.hooks,
        })
    }
}
