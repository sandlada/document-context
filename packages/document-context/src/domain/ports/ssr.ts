/**
 * SSR port.
 *
 * The server placeholder host has the smallest possible capability surface: no parent chain, no
 * events, no native object. Every request creates its own placeholder and its own application, so
 * singletons never outlive a request.
 */

import type { ServerHost } from '../model/session'

export interface SsrPort {
    /**
     * Create a placeholder host for one request.
     *
     * @returns A placeholder host that can be passed to `mount`.
     */
    createHost(): ServerHost
}
