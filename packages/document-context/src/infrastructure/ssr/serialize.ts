/**
 * SSR state serialization.
 *
 * This module turns state snapshots into embeddable JSON payload strings. It
 * is pure and DOM-free: no `window`, no `document`, no timers, so it runs
 * identically on the server, in tests, and in browsers. Every output escapes
 * `<`, `>`, `&`, U+2028, and U+2029 as `\uXXXX`, keeping the payload safe
 * inside `<script type="application/json">` embeds. The curried
 * {@link serialize} wraps the pure {@link serializeState} with synchronous
 * snapshot access for session handles.
 */
import type { Observable } from 'rxjs'
import type { Session } from '../../domain/model/session.js'
import type { SerializeOptions as ApplicationSerializeOptions } from '../../application/context.js'

/**
 * Options accepted by {@link serialize}. Canonical shape lives in
 * `application/context.js`; this alias only restores the omitted-generic
 * default so server-only consumers can write a bare `SerializeOptions`.
 * Type-only: erased at runtime.
 *
 * @param S Session state shape.
 */
export type SerializeOptions<S extends Record<PropertyKey, unknown> = Record<PropertyKey, unknown>> = ApplicationSerializeOptions<S>

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

const ESCAPES: Record<string, string> = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
}
ESCAPES[LINE_SEPARATOR] = '\\u2028'
ESCAPES[PARAGRAPH_SEPARATOR] = '\\u2029'

const UNSAFE_PATTERN = new RegExp(`[<>&${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, 'g')

/**
 * Serializes a state snapshot (or its selected subset) to an embed-safe JSON
 * string. Pure: the input is only read, never mutated, and identical inputs
 * always produce identical outputs.
 *
 * @param state Snapshot to serialize.
 * @param select Optional subset projector; defaults to the full snapshot.
 * @returns The escaped JSON payload string (`null` for undefined selections).
 * @throws {TypeError} When the selected value is not JSON-serializable
 * (circular structures, `BigInt`), surfacing the natural `JSON.stringify`
 * failure.
 * @example
 * ```ts
 * import { serializeState } from './serialize.js'
 *
 * const payload = serializeState({ count: 1 }, (current) => ({ count: current.count }))
 * ```
 */
export function serializeState<S extends Record<PropertyKey, unknown>>(state: S, select?: (state: S) => unknown): string {
    const selected: unknown = select === undefined ? state : select(state)
    const json = JSON.stringify(selected) ?? 'null'
    UNSAFE_PATTERN.lastIndex = 0
    return json.replace(UNSAFE_PATTERN, (character) => ESCAPES[character] ?? character)
}

/**
 * Curried session serializer for server rendering: `serialize(options?)`
 * reads the current snapshot synchronously and delegates to
 * {@link serializeState}. The snapshot read requires a synchronously
 * emitting `state$` (as the domain store provides); colder streams throw a
 * descriptive error instead of serializing stale or absent state.
 *
 * @param options Optional subset projector; defaults to the full snapshot.
 * @returns Function serializing a session handle to its payload string.
 * @throws {Error} When `state$` emits nothing synchronously.
 * @example
 * ```ts
 * import { serialize } from './serialize.js'
 *
 * const payload = serialize()(session)
 * ```
 */
export function serialize<S extends Record<PropertyKey, unknown>>(options?: SerializeOptions<S>): (session: Pick<Session<S>, 'state$'>) => string {
    return (session: Pick<Session<S>, 'state$'>): string => {
        const states: Array<S> = []
        const subscription = (session.state$ as Observable<S>).subscribe((state) => {
            states.push(state)
        })
        subscription.unsubscribe()
        const snapshot = states[0]
        if (snapshot === undefined) {
            throw new Error('[serialize] state$ emitted nothing synchronously; provide a BehaviorSubject-backed state$')
        }
        const select = options?.select
        return select === undefined ? serializeState(snapshot) : serializeState(snapshot, select)
    }
}
