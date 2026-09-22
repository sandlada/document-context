// Type-checked mirrors of the examples in `src/content/docs/getting-started.md`.
//
// `npm run check:snippets` compiles this file against the library source,
// so a documentation example that stops compiling fails the docs build.
import { createContext, mount, pipe, select, update } from '@sandlada/document-context'
import { withBridge } from '@sandlada/document-context/bridge'

const blueprint = pipe(
    createContext({ count: 0 }),
    withBridge({ properties: { count: 'dataset.count' } })
)

export const session = mount(blueprint)(document.getElementById('counter-box')!)

export const getCount = select((s: { count: number }) => s.count)

export const increment = update<{ count: number }>((s) => ({ count: s.count + 1 }))

increment(session)

export const currentCount: number = getCount(session)
