// P1: WeakRef-only session registry cannot guarantee Suspended survival.
// Design claim under test: per-Document registry `Map<string, WeakRef<Session>>`
// (02b-tokens.md 2b.7, 05-lifecycle-host.md 5.5) keeps a keyed Suspended session
// alive for resuscitation within suspensionTtlMs.
// Thought experiment: if NOTHING holds the session strongly, GC may collect it
// at any time -> resuscitation becomes nondeterministic -> TTL guarantee broken.
const registry = new Map()
let strong = { token: 'app:cart', state: { count: 1 } }
registry.set('app:cart', new WeakRef(strong))
strong = null // user dropped ref; registry holds ONLY the WeakRef now
global.gc()
await new Promise((r) => setTimeout(r, 50))
global.gc()
const deref = registry.get('app:cart').deref()
console.log('resuscitation possible after GC:', deref !== undefined)
if (deref === undefined) console.log('RESULT: WeakRef-only registry lost the Suspended session -> TTL guarantee is not implementable as written')
else console.log('RESULT: session survived (GC did not run); guarantee still nondeterministic')
