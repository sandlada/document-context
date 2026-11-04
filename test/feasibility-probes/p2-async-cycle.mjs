// P2 (final): with in-flight Promise coalescing (02-domain-model.md 2.5.2),
// an async factory cycle is a silent deadlock, not CIRCULAR_DEPENDENCY.
// Correct impl shape: register the deferred BEFORE invoking the factory.
// A awaits B, B awaits the still-unsettled A -> genuine deadlock, no stack growth.
const mode = process.argv[2] ?? 'hang'
const inflight = new Map()
const factories = {
    a: async () => `a+${await inject('b')}`,
    b: async () => `b+${await inject('a')}`,
}
function inject(token) {
    if (!inflight.has(token)) {
        let res, rej
        const gate = new Promise((a, b) => { res = a; rej = b })
        inflight.set(token, gate) // registered BEFORE factory runs (re-entrancy safe)
        factories[token]().then(res, rej)
    }
    return inflight.get(token)
}
if (mode === 'hang') {
    console.log('inject(a) where a<->b await each other (expect: hang, no error)...')
    await inject('a')
    console.log('UNEXPECTED: resolved')
} else {
    const r = await Promise.race([
        inject('a'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('RESOLUTION_TIMEOUT')), 200)),
    ]).catch((e) => e.message)
    console.log('with timeoutMs=200 ->', r)
    console.log('RESULT: coalesced async cycle deadlocks silently; only an explicit timeout observes it')
}
