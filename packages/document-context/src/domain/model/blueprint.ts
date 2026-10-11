/**
 * Immutable blueprint model: the pure Phase-1 declaration of initial state,
 * service registrations, lifecycle hooks, and storage.
 *
 * This module declares types only and performs no runtime work. It stays
 * importable in a plain Node environment.
 */
import type { ServiceRegistration } from './service.js'
import type { StorageOptions } from '../ports/storage.js'
import type { Token } from './token.js'

/**
 * Lifecycle hook events a blueprint can observe. `resuscitate` names the
 * transition verb form; the emitted event form is `resuscitated`.
 */
export type BlueprintHookEvent = 'mount' | 'dispose' | 'suspend' | 'resuscitate' | 'adopt'

/**
 * A single lifecycle hook registration on a blueprint.
 */
export interface HookRegistration {
    /** Lifecycle moment the handler observes. */
    readonly event: BlueprintHookEvent
    /**
     * Hook handler. Typed with an explicit signature instead of `Function`
     * so every function shape stays assignable without losing type safety.
     */
    readonly handler: (...args: never[]) => unknown
}

/**
 * Pure immutable declaration of a context: seed state, service
 * registrations keyed by token, lifecycle hooks, and optional storage.
 * Blueprint operators produce new blueprints by structural sharing and never
 * execute factories or touch the DOM.
 */
export interface ContextBlueprint<S extends Record<PropertyKey, unknown> = Record<PropertyKey, unknown>> {
    /** Seed state; storage or payload hydration may override it at mount. */
    readonly initial: Readonly<S>
    /** Service registrations keyed by token. */
    readonly providers: ReadonlyMap<Token, ServiceRegistration>
    /** Lifecycle hooks in registration order. */
    readonly hooks: ReadonlyArray<HookRegistration>
    /** Storage options, or null when the blueprint persists nothing. */
    readonly storage: Readonly<StorageOptions> | null
}
