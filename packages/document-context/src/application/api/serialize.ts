/**
 * `serialize` SSR verb: session snapshot (or projection) to payload string.
 *
 * This module performs no DOM access, starts no timers, and holds no I/O:
 * the snapshot comes from the domain mount record indexed by the
 * application context, and the string is produced either by the injected SSR
 * adapter or by an inline JSON fallback with D-48 escaping. It runs in a
 * plain Node environment.
 */

import type { Session } from '../../domain/index.js'
import type { ApplicationContext, SerializeOptions } from '../context.js'

const ESCAPED: Readonly<Record<string, string>> = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
}

const ESCAPE_PATTERN = /[<>&\u2028\u2029]/g

/**
 * Encodes a value as JSON with `<`, `>`, `&`, U+2028, and U+2029 escaped as
 * `\uXXXX` sequences, so the payload stays safe inside HTML script tags.
 * An `undefined` value (for example a `select` returning nothing) encodes
 * as `'null'`, matching JSON's lack of an undefined literal.
 *
 * @param value JSON-safe value to encode.
 * @returns The escaped JSON string.
 */
const encodeJson = (value: unknown): string => {
    const json = JSON.stringify(value) ?? 'null'
    return json.replace(ESCAPE_PATTERN, (char) => ESCAPED[char] ?? char)
}

/**
 * Binds the context into the data-last `serialize` verb: `serialize` takes
 * optional options, then a session, and returns the payload string. The
 * session resolves through `ctx.records` to its live snapshot; `select`
 * projects it (default: the full snapshot). When `ports.ssr` is present the
 * call delegates to its `serialize`; otherwise the inline JSON fallback
 * above produces the payload.
 *
 * @param ctx Application context indexing mount records by session facade.
 * @returns Data-last verb mapping options to a session-to-string mapper.
 * @throws Plain `Error` when the session has no mount record in this
 * application (for example a foreign session from another application).
 * @example
 * ```ts
 * import { createSerialize } from './serialize.js'
 *
 * const serialize = createSerialize(ctx)
 * const payload = serialize()(session)
 * const countOnly = serialize({ select: (s) => s.count })(session)
 * ```
 */
export function createSerialize(
    ctx: ApplicationContext,
): <S extends Record<PropertyKey, unknown>>(options?: SerializeOptions<S>) => (session: Session<S>) => string {
    return <S extends Record<PropertyKey, unknown>>(options?: SerializeOptions<S>): ((session: Session<S>) => string) => {
        if (ctx.ports.ssr !== undefined) {
            return ctx.ports.ssr.serialize(options)
        }
        const select = options?.select
        return (session: Session<S>): string => {
            const record = ctx.records.get(session)
            if (record === undefined) {
                throw new Error('[document-context] serialize: session has no mount record in this application')
            }
            const snapshot = record.sessionState.getSnapshot() as S
            const projected: unknown = select === undefined ? snapshot : select(snapshot)
            return encodeJson(projected)
        }
    }
}
