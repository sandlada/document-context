/**
 * E2E: vanilla counter page flow with real elements and real events.
 *
 * Runs in happy-dom with no test doubles: a container with a label and a
 * button is mounted through the public entry, a click listener drives
 * `update`, and a `subscribe$` subscription re-renders the label. Clicking
 * the button is the only state driver, exactly like a user journey.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
    createContext,
    dispose,
    mount,
    pipe,
    selectSync,
    subscribe$,
    update,
} from '../index.js'
import type { Session } from '../domain/index.js'

afterEach(() => {
    document.body.innerHTML = ''
})

interface CounterState extends Record<PropertyKey, unknown> {
    count: number
}

const buildPage = (): { root: HTMLDivElement, label: HTMLSpanElement, button: HTMLButtonElement } => {
    const root = document.createElement('div')
    root.id = 'counter-app'
    const label = document.createElement('span')
    label.id = 'count-label'
    const button = document.createElement('button')
    button.id = 'inc-btn'
    button.textContent = 'Increment'
    root.appendChild(label)
    root.appendChild(button)
    document.body.appendChild(root)
    return { root, label, button }
}

describe('vanilla counter page', () => {
    it('renders the seed, increments on clicks, and re-renders every state', async () => {
        const { root, label, button } = buildPage()
        try {
            const session = await mount(pipe(createContext({ count: 0 })))(root) as Session<CounterState, HTMLDivElement>
            const renders: Array<string> = []
            try {
                const subscription = subscribe$((state: CounterState) => {
                    label.textContent = `Count: ${state.count}`
                    renders.push(label.textContent)
                })(session)
                button.addEventListener('click', () => {
                    update<CounterState>((state) => ({ count: state.count + 1 }))(session)
                })

                button.click()
                button.click()
                button.click()
                await Promise.resolve()

                expect(selectSync((state: CounterState) => state.count)(session)).toBe(3)
                expect(label.textContent).toBe('Count: 3')
                expect(renders).toEqual(['Count: 0', 'Count: 1', 'Count: 2', 'Count: 3'])
                subscription.unsubscribe()
            } finally {
                dispose(session)
            }
        } finally {
            root.remove()
        }
    })
})
