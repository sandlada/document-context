import { describe, expect, it } from 'vitest'
import { createServiceRegistry } from '../model/service.js'
import { createSessionState } from '../model/session.js'
import { createFakeHost, createFakeScheduler } from '../testing/fakes.js'
import type { FakeHost } from '../testing/fakes.js'
import type { HostPort } from '../ports/host.js'
import type { SuspendableRecord } from './suspend-resuscitate.js'
import { evictOldest, resuscitateSession, suspendSession } from './suspend-resuscitate.js'

type State = {
    count: number
}

const makeRecord = (host: HostPort, kind: 'anonymous' | 'keyed' = 'keyed'): SuspendableRecord<State> => ({
    kind,
    token: kind === 'keyed' ? 'app:box' : null,
    host,
    status: 'mounted',
    sessionState: createSessionState<State>({ count: 1 }),
    services: createServiceRegistry(),
    abortController: new AbortController(),
    createdAt: 100,
})

describe('suspendSession', () => {
    it('parks a mounted session in suspended and schedules dispose via scheduler.timeout', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({ connected: true }))
        const handle = suspendSession(record, { scheduler, ttlMs: 50, now: () => 200 })
        expect(record.status).toBe('suspended')
        expect(handle.suspendedAt).toBe(200)
        expect(scheduler.pendingTimeouts()).toBe(1)
        expect(record.sessionState.isPoisoned()).toBe(false)
    })

    it('disposes on TTL expiry with poison and abort (Suspended to Disposed)', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({ connected: false }))
        suspendSession(record, { scheduler, ttlMs: 50 })
        scheduler.flushTimeouts()
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
        expect(record.abortController.signal.aborted).toBe(true)
    })

    it('cancels the pending dispose when disposeNow runs before expiry', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        const handle = suspendSession(record, { scheduler, ttlMs: 50 })
        handle.disposeNow()
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
        expect(scheduler.pendingTimeouts()).toBe(0)
        scheduler.flushTimeouts()
        expect(record.status).toBe('disposed')
    })

    it('makes cancelDispose idempotent and inert after disposal', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        const handle = suspendSession(record, { scheduler, ttlMs: 50 })
        handle.cancelDispose()
        expect(scheduler.pendingTimeouts()).toBe(0)
        expect(record.status).toBe('suspended')
        expect(() => handle.cancelDispose()).not.toThrow()
        scheduler.flushTimeouts()
        expect(record.status).toBe('suspended')
    })

    it('throws a plain config Error for Infinity without retention pinned', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        expect(() => suspendSession(record, { scheduler, ttlMs: Infinity })).toThrow(Error)
        expect(record.status).toBe('mounted')
    })

    it('holds pinned Infinity sessions without a timer until explicit dispose', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        const handle = suspendSession(record, { scheduler, ttlMs: Infinity, retention: 'pinned' })
        expect(record.status).toBe('suspended')
        expect(scheduler.pendingTimeouts()).toBe(0)
        scheduler.flushAll()
        expect(record.status).toBe('suspended')
        handle.disposeNow()
        expect(record.status).toBe('disposed')
    })

    it('disposes immediately for ttlMs 0 without parking', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        const handle = suspendSession(record, { scheduler, ttlMs: 0 })
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
        expect(scheduler.pendingTimeouts()).toBe(0)
        expect(handle.suspendedAt).toBeDefined()
    })

    it('supports suspending from initializing via wait-disconnect', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}), 'keyed')
        record.status = 'initializing'
        const handle = suspendSession(record, { scheduler, ttlMs: 50, now: () => 7 })
        expect(record.status).toBe('suspended')
        expect(handle.suspendedAt).toBe(7)
    })

    it('rejects suspending a disposed record with a plain Error', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        record.status = 'disposed'
        expect(() => suspendSession(record, { scheduler, ttlMs: 50 })).toThrow(Error)
    })
})

describe('resuscitateSession', () => {
    it('returns the same record with mounted status and the new host, without re-hydration', () => {
        const scheduler = createFakeScheduler()
        const oldHost = createFakeHost({ connected: false })
        const record = makeRecord(oldHost)
        record.sessionState.update({ count: 41 })
        const handle = suspendSession(record, { scheduler, ttlMs: 50 })
        const newHost: FakeHost = createFakeHost({ connected: true })
        const revived = resuscitateSession(handle, newHost)
        expect(revived).toBe(record)
        expect(revived.status).toBe('mounted')
        expect(revived.host).toBe(newHost)
        expect(revived.sessionState).toBe(record.sessionState)
        expect(revived.services).toBe(record.services)
        expect(revived.sessionState.getSnapshot()).toEqual({ count: 41 })
    })

    it('cancels the pending TTL so a later flush does not dispose', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        const handle = suspendSession(record, { scheduler, ttlMs: 50 })
        resuscitateSession(handle, createFakeHost({ connected: true }))
        expect(scheduler.pendingTimeouts()).toBe(0)
        scheduler.flushTimeouts()
        expect(record.status).toBe('mounted')
        expect(record.sessionState.isPoisoned()).toBe(false)
    })

    it('accepts a bare suspended record as well as a handle', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        const handle = suspendSession(record, { scheduler, ttlMs: 50 })
        handle.cancelDispose()
        const revived = resuscitateSession(record, createFakeHost({ connected: true }))
        expect(revived.status).toBe('mounted')
    })

    it('keeps services and state evolving after resuscitation (no re-hydration)', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        const handle = suspendSession(record, { scheduler, ttlMs: 50 })
        const revived = resuscitateSession(handle, createFakeHost({ connected: true }))
        revived.sessionState.update({ count: 2 })
        expect(revived.sessionState.getSnapshot()).toEqual({ count: 2 })
    })

    it('rejects resuscitating a non-suspended record', () => {
        const record = makeRecord(createFakeHost({}))
        expect(() => resuscitateSession(record, createFakeHost({}))).toThrow(Error)
    })
})

describe('evictOldest', () => {
    it('returns null for an empty list', () => {
        expect(evictOldest([])).toBeNull()
    })

    it('returns the oldest suspended entry first for maxSuspendedPerDocument', () => {
        const scheduler = createFakeScheduler()
        const first = suspendSession(makeRecord(createFakeHost({})), { scheduler, ttlMs: 50, now: () => 10 })
        const second = suspendSession(makeRecord(createFakeHost({})), { scheduler, ttlMs: 50, now: () => 20 })
        const third = suspendSession(makeRecord(createFakeHost({})), { scheduler, ttlMs: 50, now: () => 15 })
        expect(evictOldest([second, third, first])).toBe(first)
        expect(evictOldest([third, second])).toBe(third)
    })

    it('breaks suspendedAt ties by input order (stable oldest-first)', () => {
        const scheduler = createFakeScheduler()
        const first = suspendSession(makeRecord(createFakeHost({})), { scheduler, ttlMs: 50, now: () => 5 })
        const second = suspendSession(makeRecord(createFakeHost({})), { scheduler, ttlMs: 50, now: () => 5 })
        expect(evictOldest([first, second])).toBe(first)
        expect(evictOldest([second, first])).toBe(second)
    })
})

describe('suspendSession ttlMs 0 and dispose edges', () => {
    it('disposes immediately from initializing via the abort transition (D-82 waiting path)', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}), 'keyed')
        record.status = 'initializing'
        const handle = suspendSession(record, { scheduler, ttlMs: 0, now: () => 11 })
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
        expect(record.abortController.signal.aborted).toBe(true)
        expect(handle.suspendedAt).toBe(11)
        expect(handle.didDispose()).toBe(true)
        expect(() => handle.cancelDispose()).not.toThrow()
        expect(() => handle.disposeNow()).not.toThrow()
        expect(handle.didDispose()).toBe(true)
    })

    it('skips a second abort when the controller is already aborted (ttlMs 0)', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        record.abortController.abort(new Error('pre-aborted'))
        const handle = suspendSession(record, { scheduler, ttlMs: 0 })
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
        expect(handle.didDispose()).toBe(true)
    })

    it('makes a second disposeNow a no-op (idempotent)', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        const handle = suspendSession(record, { scheduler, ttlMs: 50 })
        handle.disposeNow()
        expect(record.status).toBe('disposed')
        expect(handle.didDispose()).toBe(true)
        expect(() => handle.disposeNow()).not.toThrow()
        expect(record.status).toBe('disposed')
    })

    it('ignores a pending TTL after bare-record resuscitation without cancel (caller owns the timer)', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        suspendSession(record, { scheduler, ttlMs: 50 })
        const revived = resuscitateSession(record, createFakeHost({ connected: true }))
        expect(revived.status).toBe('mounted')
        expect(scheduler.pendingTimeouts()).toBe(1)
        scheduler.flushTimeouts()
        expect(record.status).toBe('mounted')
        expect(record.sessionState.isPoisoned()).toBe(false)
    })

    it('skips a second abort in disposeWith when the controller is already aborted', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        const handle = suspendSession(record, { scheduler, ttlMs: 50 })
        record.abortController.abort(new Error('pre-aborted'))
        handle.disposeNow()
        expect(record.status).toBe('disposed')
        expect(record.sessionState.isPoisoned()).toBe(true)
        expect(handle.didDispose()).toBe(true)
    })

    it('reports didDispose across suspended, disposed, and externally disposed records', () => {
        const scheduler = createFakeScheduler()
        const record = makeRecord(createFakeHost({}))
        const handle = suspendSession(record, { scheduler, ttlMs: 50 })
        expect(handle.didDispose()).toBe(false)
        handle.disposeNow()
        expect(handle.didDispose()).toBe(true)

        const other = makeRecord(createFakeHost({}))
        const otherHandle = suspendSession(other, { scheduler, ttlMs: 50 })
        expect(otherHandle.didDispose()).toBe(false)
        other.status = 'disposed'
        expect(otherHandle.didDispose()).toBe(true)
    })
})
