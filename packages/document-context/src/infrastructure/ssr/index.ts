/**
 * SSR infrastructure: the placeholder host and the request scoped application.
 *
 * @packageDocumentation
 */

import { createApplication, type Application } from '../../application/application'
import type { ServerHost } from '../../domain/model/session'
import {
    createServerScheduler,
    createSsrHostAdapter,
    createSsrPort,
    type SsrHost,
    type SsrHostAdapter,
    type SsrScopeTransport,
} from './server-host'

export {
    createServerScheduler,
    createSsrHostAdapter,
    createSsrPort,
} from './server-host'
export type { SsrHost, SsrHostAdapter, SsrScopeTransport } from './server-host'

/**
 * Create an application for one server request.
 *
 * Every request gets its own application, so singletons and keyed sessions never leak from one
 * request into the next.
 *
 * @example
 * ```ts
 * import { createContext } from '@sandlada/document-context'
 * import { createSsrApplication } from '@sandlada/document-context/infrastructure/ssr'
 *
 * const app = createSsrApplication()
 * const serverHost = app.ports.ssr?.createHost() ?? { kind: 'server' as const }
 *
 * const ssrBlueprint = createContext({ title: 'SSR Page', preloaded: true })
 * const session = app.mount(ssrBlueprint)(serverHost)
 * await session.ready
 *
 * const state = app.read((s: { title: string }) => s.title)(session)
 * console.log('Rendered title:', state) // 'SSR Page'
 *
 * app.dispose(session)
 * app.release()
 * ```
 *
 * @returns The application.
 */
export function createSsrApplication(): Application<SsrHost, ServerHost> {
    const host = createSsrHostAdapter()
    const ssr = createSsrPort()
    return createApplication<SsrHost, ServerHost>({ host, ssr })
}
