/**
 * Hook execution.
 *
 * `onMount`, `onSuspend`, `onResume` and `onAdopt` run in FIFO order; `onDispose` runs in LIFO
 * order. A hook that returns a function registers a cleanup callback; a hook that returns a promise
 * is awaited and its resolved value is **not** treated as a cleanup callback.
 */

import { DocumentContextError } from '../../domain/model/errors'
import type { HookFn, HookType } from '../../domain/model/blueprint'
import type { SessionRuntime } from '../session'

/**
 * Run every hook of a type in FIFO order.
 *
 * `onMount` is the only fatal hook: when it fails, `ready` rejects and the session is disposed.
 * Every other hook reports its failure to `errors$` and lets the remaining hooks run.
 *
 * @param session - The session.
 * @param type - The hook type.
 * @returns A promise that settles when every hook settled.
 */
export async function runHooks(session: SessionRuntime<any>, type: HookType): Promise<void> {
    const fatal = type === 'mount'
    for (const hook of session.blueprint.hooks) {
        if (hook.type !== type) {
            continue
        }
        await invokeHook(session, hook.hook, fatal)
    }
}

/**
 * Run every hook of a type in FIFO order, without awaiting.
 *
 * Used on the resuscitation path, where the session is already initialized and the transition must
 * happen synchronously. Promises returned by the hooks are collected on the session.
 *
 * @param session - The session.
 * @param type - The hook type.
 */
export function runHooksSync(session: SessionRuntime<any>, type: HookType): void {
    for (const hook of session.blueprint.hooks) {
        if (hook.type !== type) {
            continue
        }
        try {
            const result = hook.hook(session)
            if (typeof result === 'function') {
                session.cleanups.push(result)
            } else if (result instanceof Promise) {
                session.pendingCleanups.push(reportRejectedHook(session, result, 'Hook failed.'))
            }
        } catch (error) {
            session.reportError(
                new DocumentContextError('HOOK_ERROR', 'Hook failed.', {
                    details: { cause: error },
                }),
            )
        }
    }
}

/**
 * Run every `onDispose` hook in LIFO order.
 *
 * Promises returned by the hooks are collected on the session instead of being awaited, so that
 * `dispose` stays synchronous. A function return runs immediately as a cleanup. A promise's resolved
 * value is not a cleanup.
 *
 * @param session - The session.
 */
export function runDisposeHooks(session: SessionRuntime<any>): void {
    const hooks = session.blueprint.hooks.filter((hook) => hook.type === 'dispose')
    for (const hook of [...hooks].reverse()) {
        try {
            const result = hook.hook(session)
            if (typeof result === 'function') {
                try {
                    result()
                } catch (error) {
                    session.reportError(
                        new DocumentContextError('HOOK_ERROR', 'Dispose cleanup failed.', {
                            details: { cause: error },
                        }),
                    )
                }
            } else if (result instanceof Promise) {
                session.pendingCleanups.push(
                    reportRejectedHook(session, result, 'Dispose hook failed.'),
                )
            }
        } catch (error) {
            session.reportError(
                new DocumentContextError('HOOK_ERROR', 'Dispose hook failed.', {
                    details: { cause: error },
                }),
            )
        }
    }
}

/**
 * Run the cleanup callbacks collected from `onMount` hooks, in LIFO order.
 *
 * @param session - The session.
 */
export function runCleanups(session: SessionRuntime<any>): void {
    for (const cleanup of [...session.cleanups].reverse()) {
        try {
            cleanup()
        } catch (error) {
            session.reportError(
                new DocumentContextError('HOOK_ERROR', 'Cleanup failed.', {
                    details: { cause: error },
                }),
            )
        }
    }
    session.cleanups.length = 0
}

function reportRejectedHook(
    session: SessionRuntime<any>,
    result: Promise<unknown>,
    message: string,
): Promise<unknown> {
    return result.then(
        () => undefined,
        (error: unknown) => {
            session.reportError(
                new DocumentContextError('HOOK_ERROR', message, {
                    details: { cause: error },
                }),
            )
        },
    )
}

async function invokeHook(
    session: SessionRuntime<any>,
    hook: HookFn,
    fatal = false,
): Promise<void> {
    try {
        const result = hook(session)
        if (typeof result === 'function') {
            session.cleanups.push(result)
        } else if (result instanceof Promise) {
            await result
        }
    } catch (error) {
        if (fatal) {
            throw error
        }
        session.reportError(
            new DocumentContextError('HOOK_ERROR', 'Hook failed.', {
                details: { cause: error },
            }),
        )
    }
}
