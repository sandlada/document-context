/**
 * Pure ancestry helpers for scope resolution: walking `HostPort.parent`
 * chains, picking the nearest matching provider scope, and ordering multi
 * provider entries without DOM access.
 *
 * This module is pure: no DOM access, no timers, no I/O. It runs in a plain
 * Node environment. State never crosses sessions; these helpers only order
 * and select scopes along the ancestor chain for service resolution.
 */
import type { HostPort } from '../ports/host.js'

/**
 * Resolution direction for multi providers: `bottomUp` walks from the
 * nearest scope outward (default), `topDown` walks from the farthest scope
 * inward. Single-value resolution is always nearest-wins and takes no
 * direction.
 */
export type ScopeDirection = 'bottomUp' | 'topDown'

/**
 * One discovered multi-provider entry. `depth` is the parent-hop distance
 * from the resolution origin (`0` is the origin scope itself); `order` is the
 * registration sequence within the same scope, breaking same-depth ties.
 */
export interface ScopedEntry<T = unknown> {
    /** The provided value or in-flight promise handed to the caller. */
    readonly value: T
    /** Parent-hop distance from the resolution origin; smaller is nearer. */
    readonly depth: number
    /** Registration sequence within the same scope; smaller registered first. */
    readonly order: number
}

/**
 * Walks the `parent` chain bottom-up, starting with the host itself and
 * ending at the root whose parent is null.
 *
 * @param host The host to start from (nearest first).
 * @returns A fresh array of the host, its parent, and so on up to the root.
 * @example
 * ```ts
 * import { collectAncestors } from './scope.js'
 * import type { HostPort } from '../ports/host.js'
 *
 * declare const host: HostPort
 * const chain = collectAncestors(host)
 * console.log(chain.length)
 * ```
 */
export function collectAncestors<Native = unknown>(host: HostPort<Native>): Array<HostPort<Native>> {
    const chain: Array<HostPort<Native>> = []
    let current: HostPort<Native> | null = host
    while (current !== null) {
        chain.push(current)
        current = current.parent
    }
    return chain
}

/**
 * Returns the first host in a bottom-up chain (as produced by
 * `collectAncestors`) satisfying the predicate, so the nearest scope wins.
 *
 * @param hosts Candidate hosts in bottom-up order, nearest first.
 * @param predicate Test applied to each host with its bottom-up index.
 * @returns The nearest matching host, or null when nothing matches.
 * @example
 * ```ts
 * import { collectAncestors, nearestProvider } from './scope.js'
 * import type { HostPort } from '../ports/host.js'
 *
 * declare const host: HostPort
 * const provider = nearestProvider(collectAncestors(host), () => true)
 * console.log(provider === null)
 * ```
 */
export function nearestProvider<Native = unknown>(
    hosts: ReadonlyArray<HostPort<Native>>,
    predicate: (host: HostPort<Native>, index: number) => boolean,
): HostPort<Native> | null {
    for (let index = 0; index < hosts.length; index += 1) {
        const host = hosts[index]
        if (host !== undefined && predicate(host, index)) {
            return host
        }
    }
    return null
}

/**
 * Orders multi-provider entries by scope depth with an explicit
 * registration-order tiebreak: `bottomUp` sorts depth ascending
 * (nearest-first), `topDown` sorts depth descending (farthest-first), and
 * equal depths sort by `order` ascending. The input is never mutated; a
 * sorted copy is returned.
 *
 * @param entries Discovered entries carrying explicit depth and order.
 * @param direction `bottomUp` for nearest-first, `topDown` for farthest-first.
 * @returns A new array in resolution order.
 * @example
 * ```ts
 * import { orderEntries } from './scope.js'
 *
 * const sorted = orderEntries([
 *     { value: 'far', depth: 2, order: 0 },
 *     { value: 'near', depth: 0, order: 0 },
 * ], 'bottomUp')
 * console.log(sorted.map((entry) => entry.value))
 * ```
 */
export function orderEntries<T>(
    entries: ReadonlyArray<ScopedEntry<T>>,
    direction: ScopeDirection,
): Array<ScopedEntry<T>> {
    const copy = [...entries]
    copy.sort((first, second) => {
        if (first.depth !== second.depth) {
            return direction === 'bottomUp' ? first.depth - second.depth : second.depth - first.depth
        }
        return first.order - second.order
    })
    return copy
}

/**
 * Provider-flavored alias of `orderEntries` with identical semantics; both
 * names are supported so call sites can pick the vocabulary fitting a
 * provider list versus a generic entry list.
 */
export const orderProviders = orderEntries
