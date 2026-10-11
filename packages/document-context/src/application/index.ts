/**
 * Application barrel: context, assembly, and verb factories.
 *
 * This file only re-exports; the composition root (package entry, owned by
 * the infrastructure track) injects real adapters and publishes the bound
 * verbs.
 */

export {
    type ApplicationContext,
    type ApplicationPorts,
    createApplicationContext,
    createHostSessionMap,
    createKeyedSessionMap,
    type HostAdapter,
    type HostSessionMap,
    type KeyedSessionMap,
    type PayloadResolver,
    type SerializeOptions,
    type SingletonEntry,
    type SsrAdapter,
    type StorageRegistry,
} from './context.js'
export { type Application, createApplication } from './create-application.js'
export type { LateTarget } from './api/inject.js'
export * from './api/index.js'
