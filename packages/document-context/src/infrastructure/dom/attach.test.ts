import { describe, expect, it, vi } from 'vitest'
import { Subject } from 'rxjs'
import { bindSessionAnnouncements, CONTEXT_DISPOSE_EVENT, CONTEXT_MOUNT_EVENT } from './attach.js'
import type { HostPort } from '../../domain/ports/host.js'
import type { LifecycleEvent, Session } from '../../domain/model/session.js'
import { EMPTY } from 'rxjs'

const stubHost = (nativeValue: unknown): HostPort => ({
    token: null,
    isConnected: true,
    parent: null,
    lifecycle$: EMPTY,
    on: () => () => {},
    native: () => nativeValue,
})

interface SessionDriver {
    readonly session: Session
    readonly lifecycle: Subject<LifecycleEvent>
}

const driveSession = (nativeValue: unknown, token: string | null): SessionDriver => {
    const lifecycle = new Subject<LifecycleEvent>()
    const session = {
        host: stubHost(nativeValue),
        token,
        lifecycle$: lifecycle.asObservable(),
    } as unknown as Session
    return { session, lifecycle }
}

const listen = (target: EventTarget, type: string): Array<CustomEvent> => {
    const received: Array<CustomEvent> = []
    target.addEventListener(type, (event) => {
        received.push(event as CustomEvent)
    })
    return received
}

describe('bindSessionAnnouncements', () => {
    it('uses the normative cross-bundle event names', () => {
        expect(CONTEXT_MOUNT_EVENT).toBe('context-mount')
        expect(CONTEXT_DISPOSE_EVENT).toBe('context-dispose')
    })

    it('dispatches context-mount with the session token on mounted', () => {
        const element = document.createElement('div')
        document.body.appendChild(element)
        try {
            const { session, lifecycle } = driveSession(element, 'app:box')
            const received = listen(element, 'context-mount')
            const unsubscribe = bindSessionAnnouncements(session)
            try {
                lifecycle.next({ type: 'mounted' })
                expect(received.length).toBe(1)
                const event = received[0] as CustomEvent
                expect(event.detail).toEqual({ token: 'app:box' })
                expect(event.bubbles).toBe(true)
                expect(event.composed).toBe(true)
                expect(event.cancelable).toBe(false)
            } finally {
                unsubscribe()
            }
        } finally {
            element.remove()
        }
    })

    it('dispatches context-mount again on resuscitated (every Mounted entry)', () => {
        const element = document.createElement('div')
        document.body.appendChild(element)
        try {
            const { session, lifecycle } = driveSession(element, 'app:box')
            const received = listen(element, 'context-mount')
            const unsubscribe = bindSessionAnnouncements(session)
            try {
                lifecycle.next({ type: 'mounted' })
                lifecycle.next({ type: 'suspended' })
                lifecycle.next({ type: 'resuscitated' })
                expect(received.length).toBe(2)
            } finally {
                unsubscribe()
            }
        } finally {
            element.remove()
        }
    })

    it('dispatches context-dispose once on disposed and stays silent otherwise', () => {
        const element = document.createElement('div')
        document.body.appendChild(element)
        try {
            const { session, lifecycle } = driveSession(element, 'app:box')
            const mounts = listen(element, 'context-mount')
            const disposes = listen(element, 'context-dispose')
            const unsubscribe = bindSessionAnnouncements(session)
            try {
                lifecycle.next({ type: 'suspended' })
                lifecycle.next({ type: 'adopted', owner: document })
                expect(mounts.length).toBe(0)
                expect(disposes.length).toBe(0)
                lifecycle.next({ type: 'disposed' })
                expect(disposes.length).toBe(1)
                expect((disposes[0] as CustomEvent).detail).toEqual({ token: 'app:box' })
                expect((disposes[0] as CustomEvent).bubbles).toBe(true)
                expect((disposes[0] as CustomEvent).composed).toBe(true)
            } finally {
                unsubscribe()
            }
        } finally {
            element.remove()
        }
    })

    it('announces a null token for anonymous sessions', () => {
        const element = document.createElement('div')
        document.body.appendChild(element)
        try {
            const { session, lifecycle } = driveSession(element, null)
            const received = listen(element, 'context-mount')
            const unsubscribe = bindSessionAnnouncements(session)
            try {
                lifecycle.next({ type: 'mounted' })
                expect((received[0] as CustomEvent).detail).toEqual({ token: null })
            } finally {
                unsubscribe()
            }
        } finally {
            element.remove()
        }
    })

    it('bubbles mount announcements to document listeners', () => {
        const element = document.createElement('section')
        document.body.appendChild(element)
        const received: Array<CustomEvent> = []
        const onMount = (event: Event): void => {
            received.push(event as CustomEvent)
        }
        document.addEventListener('context-mount', onMount)
        try {
            const { session, lifecycle } = driveSession(element, 'app:box')
            const unsubscribe = bindSessionAnnouncements(session)
            try {
                lifecycle.next({ type: 'mounted' })
                expect(received.length).toBe(1)
            } finally {
                unsubscribe()
            }
        } finally {
            document.removeEventListener('context-mount', onMount)
            element.remove()
        }
    })

    it('crosses shadow boundaries through composed dispatch', () => {
        const outer = document.createElement('div')
        document.body.appendChild(outer)
        try {
            const shadow = outer.attachShadow({ mode: 'open' })
            const inner = document.createElement('span')
            shadow.appendChild(inner)
            const { session, lifecycle } = driveSession(inner, 'app:inner')
            const received = listen(outer, 'context-mount')
            const unsubscribe = bindSessionAnnouncements(session)
            try {
                lifecycle.next({ type: 'mounted' })
                expect(received.length).toBe(1)
            } finally {
                unsubscribe()
            }
        } finally {
            outer.remove()
        }
    })

    it('stops announcing after the returned unsubscribe runs', () => {
        const element = document.createElement('div')
        document.body.appendChild(element)
        try {
            const { session, lifecycle } = driveSession(element, 'app:box')
            const received = listen(element, 'context-mount')
            const unsubscribe = bindSessionAnnouncements(session)
            unsubscribe()
            unsubscribe()
            lifecycle.next({ type: 'mounted' })
            expect(received.length).toBe(0)
        } finally {
            element.remove()
        }
    })

    it('skips silently when the native node cannot dispatch (SSR nullHost)', () => {
        const { session, lifecycle } = driveSession({}, 'app:server')
        const unsubscribe = bindSessionAnnouncements(session)
        try {
            expect(() => lifecycle.next({ type: 'mounted' })).not.toThrow()
            expect(() => lifecycle.next({ type: 'disposed' })).not.toThrow()
        } finally {
            unsubscribe()
        }
    })

    it('skips silently when reading the native node throws', () => {
        const throwingHost: HostPort = {
            token: null,
            isConnected: false,
            parent: null,
            lifecycle$: EMPTY,
            on: () => () => {},
            native: () => {
                throw new Error('detached facade')
            },
        }
        const lifecycle = new Subject<LifecycleEvent>()
        const session = { host: throwingHost, token: null, lifecycle$: lifecycle.asObservable() } as unknown as Session
        const unsubscribe = bindSessionAnnouncements(session)
        try {
            expect(() => lifecycle.next({ type: 'mounted' })).not.toThrow()
        } finally {
            unsubscribe()
        }
    })

    it('skips silently without a CustomEvent global (non-DOM runtimes)', () => {
        const element = document.createElement('div')
        document.body.appendChild(element)
        const received = listen(element, 'context-mount')
        const { session, lifecycle } = driveSession(element, 'app:box')
        const unsubscribe = bindSessionAnnouncements(session)
        const globals = globalThis as unknown as Record<string, unknown>
        const saved = globals['CustomEvent']
        globals['CustomEvent'] = undefined
        try {
            expect(() => lifecycle.next({ type: 'mounted' })).not.toThrow()
            expect(received.length).toBe(0)
        } finally {
            globals['CustomEvent'] = saved
            unsubscribe()
            element.remove()
        }
    })

    it('skips silently when dispatch throws', () => {
        const element = document.createElement('div')
        document.body.appendChild(element)
        try {
            const { session, lifecycle } = driveSession(element, 'app:box')
            element.dispatchEvent = (): never => {
                throw new Error('dispatch-denied')
            }
            const unsubscribe = bindSessionAnnouncements(session)
            try {
                expect(() => lifecycle.next({ type: 'mounted' })).not.toThrow()
            } finally {
                unsubscribe()
            }
        } finally {
            element.remove()
        }
    })
})
