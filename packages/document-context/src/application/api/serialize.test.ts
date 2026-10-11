import { describe, expect, it } from 'vitest'
import type { ContextBlueprint, MountSessionRecord, Session } from '../../domain/index.js'
import { mountSession } from '../../domain/index.js'
import type { ApplicationContext, SerializeOptions } from '../context.js'
import { createApplicationContext } from '../context.js'
import { createFakeHost, createFakeScheduler, createFakeScopeTransport, createFakeStorage } from '../../domain/testing/fakes.js'
import { createSerialize } from './serialize.js'

interface CounterState extends Record<PropertyKey, unknown> {
    count: number
    label: string
}

const blueprintFor = (initial: CounterState): ContextBlueprint<CounterState> => ({
    initial,
    providers: new Map(),
    hooks: [],
    storage: null,
})

const stubContext = (): ApplicationContext => {
    const scheduler = createFakeScheduler()
    const world = createFakeScopeTransport()
    const storage = createFakeStorage()
    return createApplicationContext({
        host: {
            toHost: () => world.createHost(),
            scheduler,
            scopeTransport: world.transport,
            tokens: {
                read: () => null,
                write: () => {},
            },
        },
        storage: {
            resolve: () => storage.port,
        },
    })
}

const mountTracked = (
    ctx: ApplicationContext,
    blueprint: ContextBlueprint<CounterState>,
): { facade: Session<CounterState>, record: MountSessionRecord<CounterState> } => {
    const host = createFakeHost({ connected: true })
    const { record } = mountSession({ blueprint, host, kind: 'anonymous', token: null, ports: { scheduler: ctx.ports.host.scheduler } })
    const facade = {} as unknown as Session<CounterState>
    ctx.records.set(facade, record as unknown as MountSessionRecord<Record<PropertyKey, unknown>>)
    return { facade, record }
}

describe('createSerialize fallback', () => {
    it('serializes the full snapshot by default', () => {
        const ctx = stubContext()
        const { facade } = mountTracked(ctx, blueprintFor({ count: 1, label: 'one' }))
        expect(createSerialize(ctx)()(facade)).toBe('{"count":1,"label":"one"}')
    })

    it('serializes only the select projection when given', () => {
        const ctx = stubContext()
        const { facade } = mountTracked(ctx, blueprintFor({ count: 1, label: 'one' }))
        expect(createSerialize(ctx)({ select: (state) => state.count })(facade)).toBe('1')
    })

    it('escapes angle brackets, ampersands, and line separators', () => {
        const ctx = stubContext()
        const raw = '<b>&  </b>'
        const { facade } = mountTracked(ctx, blueprintFor({ count: 0, label: raw }))
        const payload = createSerialize(ctx)()(facade)
        expect(payload).not.toContain('<')
        expect(payload).not.toContain('>')
        expect(payload).not.toContain('&')
        expect(payload).not.toContain(' ')
        expect(payload).not.toContain(' ')
        expect(payload).toContain('\\u003c')
        expect(payload).toContain('\\u003e')
        expect(payload).toContain('\\u0026')
        expect(payload).toContain('\\u2028')
        expect(payload).toContain('\\u2029')
        expect(JSON.parse(payload)).toEqual({ count: 0, label: raw })
    })

    it('serializes an undefined projection as null', () => {
        const ctx = stubContext()
        const { facade } = mountTracked(ctx, blueprintFor({ count: 1, label: 'one' }))
        expect(createSerialize(ctx)({ select: () => undefined })(facade)).toBe('null')
    })

    it('reads the live snapshot, not the seed', () => {
        const ctx = stubContext()
        const { facade, record } = mountTracked(ctx, blueprintFor({ count: 0, label: 'zero' }))
        record.sessionState.setState({ count: 2, label: 'two' })
        expect(createSerialize(ctx)()(facade)).toBe('{"count":2,"label":"two"}')
    })

    it('throws for a session with no mount record in this application', () => {
        const ctx = stubContext()
        const stranger = {} as unknown as Session<CounterState>
        expect(() => createSerialize(ctx)()(stranger)).toThrowError(/no mount record/)
    })
})

describe('createSerialize delegation', () => {
    it('delegates to ports.ssr.serialize when an SSR adapter is present', () => {
        const ctx = stubContext()
        const seen: Array<SerializeOptions<CounterState> | undefined> = []
        ctx.ports = {
            ...ctx.ports,
            ssr: {
                nullHost: createFakeHost({ connected: false }),
                payloadResolver: null,
                serialize: <S extends Record<PropertyKey, unknown>>(options?: SerializeOptions<S>): ((session: Session<S>) => string) => {
                    seen.push(options as SerializeOptions<CounterState> | undefined)
                    return (): string => '<ssr/>'
                },
            },
        }
        const { facade } = mountTracked(ctx, blueprintFor({ count: 1, label: 'one' }))
        const options: SerializeOptions<CounterState> = { select: (state) => state.count }
        expect(createSerialize(ctx)(options)(facade)).toBe('<ssr/>')
        expect(seen).toEqual([options])
    })
})
