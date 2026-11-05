/**
 * Lifecycle hook operators.
 *
 * Every hook is a pure blueprint operator: it appends a registration and returns a new blueprint.
 * Nothing runs before `mount`.
 */

import type { Blueprint, BlueprintOperator, HookFn, HookType } from '../../domain/model/blueprint'

function hookOperator(type: HookType, hook: HookFn): BlueprintOperator<any> {
    return (blueprint: Blueprint<any>): Blueprint<any> => {
        const registration = { type, hook, order: blueprint.hooks.length }
        return Object.freeze({
            state: blueprint.state,
            providers: blueprint.providers,
            hooks: Object.freeze([...blueprint.hooks, registration]),
        })
    }
}

/**
 * Run a hook the first time the session becomes `active`.
 *
 * The hook may return a cleanup function — it runs when the session is finally disposed, before
 * the `onDispose` hooks. It may also return a promise; `ready` waits for it.
 *
 * @example
 * ```ts
 * import { createContext, pipe, onMount, mount, dispose } from '@sandlada/document-context'
 *
 * let timerRunning = false
 *
 * const timerBlueprint = pipe(
 *     createContext({ ticks: 0 }),
 *     onMount((session) => {
 *         timerRunning = true
 *         // Return cleanup callback executed when the session is disposed
 *         return () => {
 *             timerRunning = false
 *         }
 *     }),
 * )
 *
 * const host = document.getElementById('timer-host')!
 * const session = mount(timerBlueprint)(host)
 * await session.ready
 * console.log(timerRunning) // true
 *
 * dispose(session)
 * console.log(timerRunning) // false
 * ```
 *
 * @param hook - The hook callback.
 * @returns A blueprint operator.
 */
export function onMount(hook: HookFn): BlueprintOperator<any> {
    return hookOperator('mount', hook)
}

/**
 * Run a hook when the session is disposed. Disposal hooks run in LIFO order.
 *
 * @example
 * ```ts
 * import { createContext, pipe, onDispose, mount, dispose } from '@sandlada/document-context'
 *
 * const resourceBlueprint = pipe(
 *     createContext({ open: true }),
 *     onDispose((session) => {
 *         console.log('Session disposed, releasing resources')
 *     }),
 * )
 *
 * const host = document.getElementById('resource-host')!
 * const session = mount(resourceBlueprint)(host)
 * await session.ready
 *
 * dispose(session) // triggers onDispose callback
 * ```
 *
 * @param hook - The hook callback.
 * @returns A blueprint operator.
 */
export function onDispose(hook: HookFn): BlueprintOperator<any> {
    return hookOperator('dispose', hook)
}

/**
 * Run a hook when the session moves from `active` to `suspended`.
 *
 * @example
 * ```ts
 * import { createContext, pipe, onSuspend, onResume, mount } from '@sandlada/document-context'
 *
 * const canvasBlueprint = pipe(
 *     createContext({ running: true }),
 *     onSuspend((session) => {
 *         // Host was disconnected from DOM: pause rendering loop
 *         console.log('Session suspended: rendering paused')
 *     }),
 *     onResume((session) => {
 *         // Session resuscitated within TTL: resume rendering loop
 *         console.log('Session resumed: rendering restarted')
 *     }),
 * )
 *
 * const host = document.getElementById('canvas-host')!
 * const session = mount(canvasBlueprint, { token: 'app:canvas', suspensionTtlMs: 3000 })(host)
 * await session.ready
 * ```
 *
 * @param hook - The hook callback.
 * @returns A blueprint operator.
 */
export function onSuspend(hook: HookFn): BlueprintOperator<any> {
    return hookOperator('suspend', hook)
}

/**
 * Run a hook when a suspended session resumes.
 *
 * @example
 * ```ts
 * import { createContext, pipe, onResume, mount } from '@sandlada/document-context'
 *
 * const liveBlueprint = pipe(
 *     createContext({ reconnecting: false }),
 *     onResume((session) => {
 *         console.log('Keyed session resuscitated on new host element')
 *     }),
 * )
 *
 * const host = document.getElementById('feed-host')!
 * const session = mount(liveBlueprint, { token: 'app:feed', suspensionTtlMs: 2000 })(host)
 * await session.ready
 * ```
 *
 * @param hook - The hook callback.
 * @returns A blueprint operator.
 */
export function onResume(hook: HookFn): BlueprintOperator<any> {
    return hookOperator('resume', hook)
}

/**
 * Run a hook when the host node is adopted into another document.
 *
 * @example
 * ```ts
 * import { createContext, pipe, onAdopt, mount } from '@sandlada/document-context'
 *
 * const iframeBlueprint = pipe(
 *     createContext({ mode: 'embedded' }),
 *     onAdopt((session) => {
 *         console.log('Host node adopted into a different Document or ShadowRoot')
 *     }),
 * )
 *
 * const host = document.createElement('div')
 * const session = mount(iframeBlueprint)(host)
 * await session.ready
 * ```
 *
 * @param hook - The hook callback.
 * @returns A blueprint operator.
 */
export function onAdopt(hook: HookFn): BlueprintOperator<any> {
    return hookOperator('adopt', hook)
}
