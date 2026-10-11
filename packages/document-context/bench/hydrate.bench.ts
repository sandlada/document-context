// @vitest-environment node
import { bench, describe } from 'vitest'
import { hydrateState } from '../src/domain/usecases/hydrate.js'
import type { HydrateStateInput } from '../src/domain/usecases/hydrate.js'
import { createFakeStorage } from '../src/domain/testing/fakes.js'

interface CounterState extends Record<PropertyKey, unknown> {
    count: number
    theme: string
}

const seed: CounterState = { count: 0, theme: 'light' }
const stored: CounterState = { count: 42, theme: 'dark' }
const payload: Record<string, unknown> = { count: 7 }

const envelopeOf = (state: unknown, version = 0): string => JSON.stringify({ v: version, d: state })

const largeSeed: Record<PropertyKey, unknown> = {}
for (let index = 0; index < 200; index += 1) {
    largeSeed[`key-${index}`] = index
}
const largeStored: Record<PropertyKey, unknown> = {}
for (let index = 0; index < 200; index += 1) {
    largeStored[`key-${index}`] = index * 2
}

const storage = createFakeStorage()
storage.port.write('bench:small', envelopeOf(stored))
storage.port.write('bench:large', envelopeOf(largeStored))
storage.port.write('bench:old', envelopeOf({ count: 1 }, 0))
storage.port.write('bench:corrupt', '<garbage')

const inputOf = (key: string, extra: Partial<HydrateStateInput<CounterState>> = {}): HydrateStateInput<CounterState> => ({
    blueprintInitial: { ...seed },
    storage: { port: storage.port, key },
    ...extra,
})

let sink: unknown = null
const options = { time: 100, warmupTime: 50 }

describe('hydrate', () => {
    bench('hydrateState: fresh seed only', async () => {
        sink = await hydrateState({ blueprintInitial: { ...seed } })
    }, options)

    bench('hydrateState: fresh large seed (200 keys)', async () => {
        sink = await hydrateState({ blueprintInitial: { ...largeSeed } })
    }, options)

    bench('hydrateState: storageFirst hit', async () => {
        sink = await hydrateState(inputOf('bench:small'))
    }, options)

    bench('hydrateState: storageFirst hit, large state', async () => {
        sink = await hydrateState({
            blueprintInitial: { ...largeSeed },
            storage: { port: storage.port, key: 'bench:large' },
        })
    }, options)

    bench('hydrateState: payloadFirst with payload', async () => {
        sink = await hydrateState(inputOf('bench:missing', { payload: { ...payload }, strategy: 'payloadFirst' }))
    }, options)

    bench('hydrateState: merge strategy (storage + payload)', async () => {
        sink = await hydrateState(inputOf('bench:small', { payload: { ...payload }, strategy: 'merge' }))
    }, options)

    bench('hydrateState: migrate old version', async () => {
        sink = await hydrateState(inputOf('bench:old', {
            version: 1,
            migrate: (persisted: unknown) => ({ ...(persisted as CounterState), theme: 'light' }),
        }))
    }, options)

    bench('hydrateState: corrupt storage downgrade', async () => {
        sink = await hydrateState(inputOf('bench:corrupt'))
    }, options)
})
