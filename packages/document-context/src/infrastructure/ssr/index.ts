/**
 * SSR infrastructure composition root.
 *
 * This module re-exports the server host stub, the payload resolver, and the
 * state serializer. Every export is DOM-free at import time: documents and
 * sessions enter only through factory parameters, so server runtimes import
 * safely.
 */
export { createNullHost } from './null-host.js'
export { createPayloadResolver, payloadIdFor } from './payload-resolver.js'
export type { PayloadDocument, PayloadResolver } from './payload-resolver.js'
export { serialize, serializeState } from './serialize.js'
export type { SerializeOptions } from './serialize.js'
