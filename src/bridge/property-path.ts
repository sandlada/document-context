import { validatePropertyPath } from './sanitize'

/**
 * Reads a value from a host element through a bridge dot-path.
 *
 * Supported grammars, in precedence order: `dataset.*` (string or
 * `undefined`), `style.*` including `style.--*` custom properties,
 * `aria-*` attributes, `elementInternals.value | elementInternals.state`
 * (falls back to `.value`), `hidden` (attribute-or-property boolean), any
 * native property present via `in`, and finally a plain attribute fallback.
 * Every path is validated first; dangerous segments throw
 * `PropertySyncSecurityError`.
 *
 * @param element - Host element to read from.
 * @param path - Bridge dot-path (for example `'dataset.count'`).
 * @returns The extracted DOM value, or `null` / `undefined` when absent.
 * @throws {PropertySyncSecurityError} On prototype-pollution or XSS-sink paths.
 *
 * @example
 * ```ts
 * import { readDomProperty } from '@sandlada/document-context'
 *
 * readDomProperty(el, 'dataset.count')
 * readDomProperty(el, 'style.--accent')
 * readDomProperty(input, 'value')
 * ```
 */
export function readDomProperty(element: HTMLElement, path: string): any {
    validatePropertyPath(path, element)

    if (path.startsWith('dataset.')) {
        const key = path.slice(8)
        return element.dataset[key]
    }

    if (path.startsWith('style.')) {
        const key = path.slice(6)
        if (key.startsWith('--')) {
            return element.style.getPropertyValue(key)
        }
        return (element.style as any)[key]
    }

    if (path.startsWith('aria-')) {
        return element.getAttribute(path)
    }

    if (path === 'elementInternals.value' || path === 'elementInternals.state') {
        const internals =
            (element as any)._internals ?? (element as any).elementInternals
        if (internals) {
            return internals.formValue ?? (element as any).value
        }
        return (element as any).value
    }

    if (path === 'hidden') {
        return element.hasAttribute('hidden') || element.hidden
    }

    if (path in element) {
        return (element as any)[path]
    }

    return element.getAttribute(path)
}

/**
 * Writes a state value onto a host element through a bridge dot-path.
 *
 * Mirrors `readDomProperty` grammars with DOM-appropriate null handling:
 * `null` / `undefined` deletes `dataset.*` entries, removes `style.--*` and
 * `aria-*` / plain attributes, and clears `value` and style properties to
 * `''`. Booleans for `checked | disabled | readOnly` set both the IDL
 * property and the content attribute; `hidden` toggles both together.
 * Native properties win over attributes when the path exists via `in`.
 * Every path is validated first; dangerous segments throw
 * `PropertySyncSecurityError` before any write.
 *
 * @param element - Host element to write to.
 * @param path - Bridge dot-path (for example `'dataset.count'`).
 * @param value - State value to apply; `null` / `undefined` clears.
 * @returns `void`.
 * @throws {PropertySyncSecurityError} On prototype-pollution or XSS-sink paths.
 *
 * @example
 * ```ts
 * import { writeDomProperty } from '@sandlada/document-context'
 *
 * writeDomProperty(el, 'dataset.count', 3)
 * writeDomProperty(el, 'aria-pressed', true)
 * writeDomProperty(el, 'dataset.count', null)
 * ```
 */
export function writeDomProperty(
    element: HTMLElement,
    path: string,
    value: any
): void {
    validatePropertyPath(path, element)

    if (path.startsWith('dataset.')) {
        const key = path.slice(8)
        if (value === null || value === undefined) {
            delete element.dataset[key]
        } else {
            element.dataset[key] = String(value)
        }
        return
    }

    if (path.startsWith('style.')) {
        const key = path.slice(6)
        if (key.startsWith('--')) {
            if (value === null || value === undefined) {
                element.style.removeProperty(key)
            } else {
                element.style.setProperty(key, String(value))
            }
        } else {
            ;(element.style as any)[key] =
                value === null || value === undefined ? '' : String(value)
        }
        return
    }

    if (path.startsWith('aria-')) {
        if (value === null || value === undefined) {
            element.removeAttribute(path)
        } else {
            element.setAttribute(
                path,
                typeof value === 'boolean' ? String(value) : String(value)
            )
        }
        return
    }

    if (path === 'elementInternals.value' || path === 'elementInternals.state') {
        const internals =
            (element as any)._internals ?? (element as any).elementInternals
        if (internals && typeof internals.setFormValue === 'function') {
            internals.setFormValue(value)
            return
        }
        ;(element as any).value =
            value === null || value === undefined ? '' : String(value)
        return
    }

    if (path === 'hidden') {
        if (value) {
            element.setAttribute('hidden', '')
            element.hidden = true
        } else {
            element.removeAttribute('hidden')
            element.hidden = false
        }
        return
    }

    if (path === 'checked' || path === 'disabled' || path === 'readOnly') {
        const boolVal = Boolean(value)
        ;(element as any)[path] = boolVal
        if (boolVal) {
            element.setAttribute(path, '')
        } else {
            element.removeAttribute(path)
        }
        return
    }

    if (path === 'value') {
        ;(element as any).value =
            value === null || value === undefined ? '' : String(value)
        return
    }

    if (path in element) {
        ;(element as any)[path] = value
        return
    }

    if (value === null || value === undefined) {
        element.removeAttribute(path)
    } else {
        element.setAttribute(path, String(value))
    }
}
