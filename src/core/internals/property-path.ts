export function readPropertyPath(target: any, path: string): unknown {
    if (path.indexOf('.') === -1) return target[path];
    const parts = path.split('.');
    let current = target;
    for (const part of parts) {
        if (current == null) return undefined;
        current = current[part];
    }
    return current;
}

export function writePropertyPath(target: any, path: string, value: unknown): void {
    if (path.indexOf('.') === -1) {
        target[path] = value;
        return;
    }
    const parts = path.split('.');
    let current = target;
    for (let i = 0; i < parts.length - 1; i++) current = current[parts[i]];
    current[parts[parts.length - 1]] = value;
}
