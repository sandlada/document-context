// Type-checked mirrors of the getting started quick-start example.
//
// `npm run check:snippets` compiles this file against the library source,
// so a documentation example that stops compiling fails the docs build.
import {
    createContext,
    mount,
    pipe,
    read,
    subscribe$,
    update,
} from '@sandlada/document-context'

interface AppState {
    readonly count: number
}

const blueprint = pipe(
    createContext<AppState>({ count: 0 }),
)

const host = document.getElementById('counter-box')!
export const session = mount(blueprint)(host)

export const subscription = subscribe$<AppState>((state) => {
    host.textContent = `Count: ${state.count}`
})(session)

export const increment = update<AppState>((s) => ({ count: s.count + 1 }))
increment(session)

export const count: number = read<AppState, number>((s) => s.count)(session)
