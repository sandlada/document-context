export class LibraryError extends Error { constructor(message: string, public override cause?: unknown) { super(message); this.name = new.target.name; } }
export class CircularDependencyError extends LibraryError { constructor(public readonly cycle: readonly string[]) { super('Circular dependency: ' + cycle.join(' -> ')); } }
export class UnknownScopeError extends LibraryError {}
export class UnknownServiceError extends LibraryError {}
export class InvalidInitialStateError extends LibraryError {}
export class InvalidStoredStateError extends LibraryError {}
export class InvalidPropertyError extends LibraryError {}
export class PropertySyncError extends LibraryError {}
