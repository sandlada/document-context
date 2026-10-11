/**
 * E2E: keyed session resuscitation across physical DOM moves.
 *
 * Runs in happy-dom with real elements. A keyed session mounts on one
 * element, takes state updates, then its element leaves the document; the
 * session parks suspended instead of disposing. Mounting the same blueprint
 * and token on a fresh element resuscitates the identical session with its
 * state intact, proving DOM moves never lose user state.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
    createContext,
    dispose,
    mount,
    pipe,
    selectSync,
    update,
} from '../index.js'

afterEach(() => {
    document.body.innerHTML = ''
})

const settle = async (rounds = 5): Promise<void> => {
    for (let index = 0; index < rounds; index += 1) {
        await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 0)
        })
    }
}

describe('keyed resuscitation across DOM moves', () => {
    it('parks on remove and resuscitates the same session with state intact', async () => {
        const first = document.createElement('div')
        document.body.appendChild(first)
        try {
            const blueprint = pipe(createContext({ count: 0 }))
            const session = await mount(blueprint, { token: 'app:e2e-movable' })(first)
            update({ count: 3 })(session)
            expect(selectSync((state: { count: number }) => state.count)(session)).toBe(3)

            first.remove()
            await settle()
            expect(session.isSuspended).toBe(true)
            expect(session.isDisposed).toBe(false)

            const second = document.createElement('div')
            document.body.appendChild(second)
            try {
                const revived = await mount(blueprint, { token: 'app:e2e-movable' })(second)
                expect(revived).toBe(session)
                expect(revived.isSuspended).toBe(false)
                expect(revived.isDisposed).toBe(false)
                expect(selectSync((state: { count: number }) => state.count)(revived)).toBe(3)

                update({ count: 4 })(revived)
                expect(selectSync((state: { count: number }) => state.count)(revived)).toBe(4)
                dispose(revived)
                expect(revived.isDisposed).toBe(true)
            } finally {
                second.remove()
            }
        } finally {
            first.remove()
        }
    })

    it('reparents state by moving the live element into a new parent', async () => {
        const parent = document.createElement('div')
        const holder = document.createElement('section')
        document.body.appendChild(parent)
        document.body.appendChild(holder)
        const moving = document.createElement('div')
        parent.appendChild(moving)
        try {
            const blueprint = pipe(createContext({ count: 10 }))
            const session = await mount(blueprint, { token: 'app:e2e-reparent' })(moving)
            update({ count: 11 })(session)

            holder.appendChild(moving)
            await settle()
            expect(session.isDisposed).toBe(false)
            expect(selectSync((state: { count: number }) => state.count)(session)).toBe(11)
            dispose(session)
        } finally {
            parent.remove()
            holder.remove()
        }
    })
})
