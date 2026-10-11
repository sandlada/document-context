/**
 * Application API barrel: pure re-exports of the application verb factories
 * and operators.
 *
 * A2 modules (`inject`, `get-session`, `select`, `update`, `subscribe`,
 * mount, dispose) join these re-exports as their implementations land; this
 * file only ever re-exports, never implements.
 */

export { type AttachConfig, createAttach, type HostHooks } from './attach.js'
export { createContext } from './create-context.js'
export { onAdopt, onDispose, onMount, onResuscitate, onSuspend } from './hooks.js'
export { persist } from './persist.js'
export { createPersistWiring, type PersistWiring, type PersistWriteDeps } from '../persist-wiring.js'
export { type BlueprintOperator, pipe } from './pipe.js'
export { provide, type ProvideOptions, provideSync } from './provide.js'
export { createSerialize } from './serialize.js'
