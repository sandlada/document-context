import { validatePropertyPath } from './sanitize'

/**
 * Reads a property or attribute from a DOM element using a dot-path.
 *
 * @param element The target HTMLElement.
 * @param path The property dot-path.
 * @returns The extracted DOM value.
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
 * Writes a state value to a DOM element property or attribute using a dot-path.
 *
 * @param element The target HTMLElement.
 * @param path The property dot-path.
 * @param value The value to apply.
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
