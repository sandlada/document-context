/**
 * Storage and payload hydration: the pure-async four-stage pipeline.
 *
 * This module is pure orchestration over injected ports: no DOM access, no
 * real timers. Storage reads flow through the injected `StoragePort` and
 * support `MaybePromise` for async backends. It runs in a plain Node
 * environment.
 *
 * Four stages (stage numbers fixed, wiring varies by strategy):
 * 1. read: storage and payload are read in parallel, each fault-tolerant
 *    (storage failures count as a miss; payload absence counts as unprovided;
 *    neither interrupts the mount).
 * 2. migrate: `migrate` eats only the storage raw `d`, its output replaces
 *    the storage side with priority unchanged; it is sync, single-step, with
 *    no target version. Failures yield `INVALID_STORAGE_DATA` plus the seed.
 * 3. merge: per-strategy shallow top-level merge (nested values replaced
 *    wholesale, matching `update` depth). `storageFirst` prefers storage,
 *    `payloadFirst` prefers payload, `blueprintFirst` prefers the seed,
 *    `merge` merges blueprint, storage, then payload in order. Payload holes
 *    fall through to storage then seed; the key universe is the union of all
 *    sides (missing keys are no opinion, never `undefined` deletion).
 * 4. seed-fill: keys missing from every side are backfilled from the blueprint
 *    initial. All three sides missing is a blueprint-seed completeness
 *    assertion owned by the caller (no new error code).
 *
 * Version compare on the `{ v, d }` envelope: `v === version` adopts,
 * `v < version` migrates-or-downgrades, `v > version` discards the storage
 * side, reports `INVALID_STORAGE_DATA` with a `newer-blocked` guard, and
 * enters read-only-backend mode (`writeBlocked: true`).
 *
 * Deferred to the application layer: serialization and envelope framing,
 * `reset` seed substitution, mid-hydration external-update queueing (queued as
 * a post-hydration remote write through the LWW and `conflict` pipeline, never
 * participating in priority comparison), cross-tab `observe$` wiring,
 * microtask-batched write-backs, and the `storageVersionGuard` write-gate
 * enforcement after this function returns `writeBlocked`.
 */

import { DocumentContextError } from '../model/errors.js'
import type { StoragePort } from '../ports/storage.js'

/**
 * Hydration precedence strategy. Defaults to `storageFirst`.
 */
export type HydrationStrategy = 'storageFirst' | 'payloadFirst' | 'blueprintFirst' | 'merge'

/**
 * Input for {@link hydrateState}.
 */
export interface HydrateStateInput<S extends Record<PropertyKey, unknown>> {
    /** Blueprint seed; also the backfill source for missing keys. */
    readonly blueprintInitial: S
    /** Storage side, or null when the blueprint persists nothing. */
    readonly storage?: { readonly port: StoragePort, readonly key: string } | null
    /** Plain SSR payload record, or null when unprovided. */
    readonly payload?: Record<string, unknown> | null
    /** Hydration precedence; defaults to `storageFirst`. */
    readonly strategy?: HydrationStrategy
    /** Expected envelope version; defaults to `0`. */
    readonly version?: number
    /** Single-step sync migration from an older stored shape. */
    readonly migrate?: (persisted: unknown, oldVersion: number) => Partial<S>
}

/**
 * Hydration outcome: `fresh` (seed only), `storage` / `payload` (winning side),
 * `merged` (merge strategy or multi-side win), `migrated` (migrate succeeded),
 * `invalid-downgraded` (corrupt or migrate-failed downgrade), or
 * `newer-blocked` (storage from a newer version discarded, writes guarded).
 */
export type HydrateOutcome =
    | 'fresh'
    | 'storage'
    | 'payload'
    | 'merged'
    | 'migrated'
    | 'invalid-downgraded'
    | 'newer-blocked'

/**
 * Result of {@link hydrateState}.
 */
export interface HydrateStateResult<S extends Record<PropertyKey, unknown>> {
    /** Hydrated state; a fresh object never aliasing the inputs. */
    readonly state: S
    /** Which path produced the state. */
    readonly outcome: HydrateOutcome
    /** Non-fatal `INVALID_STORAGE_DATA` entries; fatal routing stays above. */
    readonly errors: ReadonlyArray<DocumentContextError>
    /** True when the storage side was newer-blocked (read-only backend mode). */
    readonly writeBlocked: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const shallowMerge = (base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> => {
    const next: Record<string, unknown> = { ...base }
    for (const key of Object.keys(overlay)) {
        Object.defineProperty(next, key, {
            value: overlay[key],
            enumerable: true,
            writable: true,
            configurable: true,
        })
    }
    return next
}

/**
 * Runs the four-stage hydration pipeline and version compare. Never throws for
 * data problems: every downgrade is expressed in `outcome` plus `errors`.
 *
 * @param input Blueprint seed, storage handle, payload, strategy, version, migrate.
 * @returns Hydrated state, outcome, errors, and the newer-blocked write guard.
 * @example
 * ```ts
 * import { hydrateState } from './hydrate.js'
 *
 * const result = await hydrateState({ blueprintInitial: { count: 0 } })
 * console.log(result.state)
 * ```
 */
export async function hydrateState<S extends Record<PropertyKey, unknown>>(
    input: HydrateStateInput<S>,
): Promise<HydrateStateResult<S>> {
    const strategy = input.strategy ?? 'storageFirst'
    const version = input.version ?? 0
    const seed = { ...input.blueprintInitial } as Record<string, unknown>
    const errors: Array<DocumentContextError> = []

    let storageSide: Record<string, unknown> | null = null
    let storageSawEnvelope = false
    let migrated = false
    let newerBlocked = false

    const storageInput = input.storage ?? null
    if (storageInput !== null) {
        const read = await storageInput.port.read(storageInput.key)
        if (read.ok && read.value !== null) {
            storageSawEnvelope = true
            let parsed: unknown = null
            try {
                parsed = JSON.parse(read.value)
            } catch {
                parsed = null
            }
            if (isRecord(parsed) && typeof parsed['v'] === 'number' && 'd' in parsed) {
                const storedVersion = parsed['v'] as number
                const storedData: unknown = parsed['d']
                if (storedVersion === version) {
                    if (isRecord(storedData)) {
                        storageSide = { ...storedData }
                    } else {
                        errors.push(new DocumentContextError('INVALID_STORAGE_DATA', { key: storageInput.key }))
                    }
                } else if (storedVersion < version) {
                    if (input.migrate !== undefined) {
                        try {
                            const migratedPartial = input.migrate(storedData, storedVersion)
                            if (isRecord(migratedPartial)) {
                                storageSide = { ...migratedPartial }
                                migrated = true
                            } else {
                                errors.push(new DocumentContextError('INVALID_STORAGE_DATA', { key: storageInput.key }))
                            }
                        } catch {
                            errors.push(new DocumentContextError('INVALID_STORAGE_DATA', { key: storageInput.key }))
                        }
                    } else {
                        errors.push(new DocumentContextError('INVALID_STORAGE_DATA', { key: storageInput.key }))
                    }
                } else {
                    newerBlocked = true
                    errors.push(new DocumentContextError('INVALID_STORAGE_DATA', {
                        key: storageInput.key,
                        storageVersionGuard: 'newer-blocked',
                    }))
                }
            } else {
                errors.push(new DocumentContextError('INVALID_STORAGE_DATA', { key: storageInput.key }))
            }
        }
    }

    const payloadSide: Record<string, unknown> | null = isRecord(input.payload ?? null)
        ? { ...(input.payload as Record<string, unknown>) }
        : null

    let merged: Record<string, unknown>
    switch (strategy) {
        case 'storageFirst':
            merged = shallowMerge(shallowMerge(seed, payloadSide ?? {}), storageSide ?? {})
            break
        case 'payloadFirst':
            merged = shallowMerge(shallowMerge(seed, storageSide ?? {}), payloadSide ?? {})
            break
        case 'blueprintFirst':
            merged = shallowMerge(shallowMerge(storageSide ?? {}, payloadSide ?? {}), seed)
            break
        case 'merge':
            merged = shallowMerge(shallowMerge(seed, storageSide ?? {}), payloadSide ?? {})
            break
    }

    let outcome: HydrateOutcome
    if (newerBlocked) {
        outcome = 'newer-blocked'
    } else if (errors.length > 0) {
        outcome = 'invalid-downgraded'
    } else if (migrated) {
        outcome = 'migrated'
    } else if (strategy === 'merge') {
        outcome = storageSide !== null || payloadSide !== null ? 'merged' : 'fresh'
    } else if (strategy === 'storageFirst') {
        if (storageSide !== null) {
            outcome = 'storage'
        } else if (payloadSide !== null) {
            outcome = 'payload'
        } else {
            outcome = storageSawEnvelope ? 'invalid-downgraded' : 'fresh'
        }
    } else if (strategy === 'payloadFirst') {
        if (payloadSide !== null) {
            outcome = 'payload'
        } else if (storageSide !== null) {
            outcome = 'storage'
        } else {
            outcome = 'fresh'
        }
    } else {
        outcome = storageSide !== null || payloadSide !== null ? 'fresh' : 'fresh'
        if (storageSide !== null || payloadSide !== null) {
            outcome = 'fresh'
        }
    }

    return {
        state: merged as S,
        outcome,
        errors,
        writeBlocked: newerBlocked,
    }
}
