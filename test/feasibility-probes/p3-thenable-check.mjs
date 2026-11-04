// P3: MaybePromise detection must be thenable-based, not instanceof-based.
// Design claim under test: StoragePort/ScopeResolution use MaybePromise<T>
// (02-domain-model.md 2.6); mountSync must throw ASYNC_SERVICE_NOT_READY on async storage.
// Thought experiment: cross-realm promises (iframe provider, vm context, some bundler
// dual-package hazards) fail `instanceof Promise`. A mountSync implemented with
// `instanceof` would misclassify async storage as sync.
import vm from 'node:vm'
const foreign = vm.runInNewContext('Promise.resolve(1)')
const local = Promise.resolve(1)
console.log('local instanceof Promise:', local instanceof Promise)
console.log('foreign instanceof Promise:', foreign instanceof Promise)
const isThenable = (v) => v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function'
console.log('foreign thenable check:', isThenable(foreign))
if (!(foreign instanceof Promise) && isThenable(foreign)) {
    console.log('RESULT: instanceof misclassifies; spec must mandate thenable detection for MaybePromise')
}
