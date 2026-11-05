/**
 * The SSR host adapter.
 *
 * The server placeholder host has the smallest possible capability surface: no parent chain, no
 * events, no native object. Every request creates its own placeholder and its own application.
 */

import { DocumentContextError } from '../../domain/model/errors'
import type { Host, HostEventListener, HostListenerOptions, ServerHost } from '../../domain/model/session'
import type { ConnectivityPort, HostAdapter, TokensPort } from '../../domain/ports/host'
import type { SchedulerPort } from '../../domain/ports/scheduler'
import type {
    ContextRequestDetail,
    ProviderDeclaration,
    ScopeTransportPort,
} from '../../domain/ports/scope-transport'
import type { SsrPort } from '../../domain/ports/ssr'

/** A placeholder host without any DOM capability. */
export interface SsrHost extends Host {
    readonly kind: 'server'
}

/** The SSR host adapter. */
export interface SsrHostAdapter extends HostAdapter<SsrHost, ServerHost> {
    /** The in-memory scope transport. */
    readonly scope: SsrScopeTransport
}

/** The in-memory scope transport of the server. */
export interface SsrScopeTransport extends ScopeTransportPort {
    /** The provider declarations per host. */
    readonly declarations: Map<Host, ProviderDeclaration[]>
}

/**
 * Create the SSR host adapter.
 *
 * @returns The adapter.
 */
export function createSsrHostAdapter(): SsrHostAdapter {
    const hosts = new WeakMap<object, SsrHost>()
    const declarations = new Map<Host, ProviderDeclaration[]>()
    const keys = new Map<Host, string>()

    const hostOf = (placeholder: object): SsrHost => {
        const existing = hosts.get(placeholder)
        if (existing !== undefined) {
            return existing
        }
        const host: SsrHost = {
            kind: 'server',
            isConnected: true,
            parent: null,
            native(): never {
                throw new DocumentContextError(
                    'HOST_INVALID',
                    'A server host does not expose a native object.',
                )
            },
            on(_type: string, _listener: HostEventListener, _options?: HostListenerOptions): () => void {
                throw new DocumentContextError(
                    'HOST_INVALID',
                    'A server host does not dispatch events.',
                )
            },
        }
        hosts.set(placeholder, host)
        return host
    }

    const scope: SsrScopeTransport = {
        declarations,
        // Every request owns its application; the server has no other provider to ask.
        authoritative: true,
        hostOf(target: unknown): Host | null {
            if (typeof target !== 'object' || target === null) {
                return null
            }
            if ((target as { kind?: unknown }).kind !== 'server') {
                // The server has no elements: an element target is not a valid injection target.
                return null
            }
            return hostOf(target)
        },
        contains(ancestor: Host, descendant: Host): boolean {
            return ancestor === descendant
        },
        declarationsOf(host: Host): readonly ProviderDeclaration[] {
            return declarations.get(host) ?? []
        },
        declare(host: Host, entries: readonly ProviderDeclaration[]): void {
            declarations.set(host, [...entries])
        },
        undeclare(host: Host): void {
            declarations.delete(host)
        },
        onRequest(_host: Host, _handler: (detail: ContextRequestDetail) => void): () => void {
            return () => undefined
        },
        request(_host: Host, _detail: ContextRequestDetail): void {
            // The server has no event bus: every request owns its application.
        },
        announce(_host: Host, _type: 'mount' | 'dispose', _token: string | null): void {
            // The server has no event bus.
        },
        onProviderChange(_listener: () => void): () => void {
            return () => undefined
        },
    }

    const connectivity: ConnectivityPort = {
        isConnected(): boolean {
            return true
        },
        subscribe(_host: Host, _listener: (connected: boolean) => void): () => void {
            return () => undefined
        },
    }

    const tokens: TokensPort = {
        read(host: Host): string | null {
            return keys.get(host) ?? null
        },
        write(host: Host, token: string): void {
            keys.set(host, token)
        },
        remove(host: Host, token: string): void {
            if (keys.get(host) === token) {
                keys.delete(host)
            }
        },
    }

    return {
        scope,
        connectivity,
        scheduler: createServerScheduler(),
        tokens,
        normalize(target: unknown): SsrHost {
            if (typeof target !== 'object' || target === null) {
                throw new DocumentContextError(
                    'HOST_INVALID',
                    'A server host must be a placeholder object.',
                )
            }
            return hostOf(target)
        },
    }
}

/**
 * The SSR port: the placeholder factory of one request.
 *
 * @returns The port.
 */
export function createSsrPort(): SsrPort {
    return {
        createHost(): { readonly kind: 'server' } {
            return { kind: 'server' }
        },
    }
}

/**
 * The scheduler of the server.
 *
 * @returns The scheduler.
 */
export function createServerScheduler(): SchedulerPort {
    return {
        microtask(task: () => void): () => void {
            let cancelled = false
            queueMicrotask(() => {
                if (!cancelled) {
                    task()
                }
            })
            return () => {
                cancelled = true
            }
        },
        timeout(task: () => void, delayMs: number): () => void {
            const handle = setTimeout(task, delayMs)
            return () => {
                clearTimeout(handle)
            }
        },
        frame(task: () => void): () => void {
            let cancelled = false
            queueMicrotask(() => {
                if (!cancelled) {
                    task()
                }
            })
            return () => {
                cancelled = true
            }
        },
    }
}
