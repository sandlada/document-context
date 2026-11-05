# Changelog

All notable changes to `@sandlada/document-context` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0-alpha.0] - Unreleased

### Added

- Layered package under `packages/document-context`: `domain`, `application`, `infrastructure` (dom, storage, ssr).
- Public API: `createContext`, `pipe`, `provide` / `provideSync`, lifecycle hooks (`onMount`, …), `persist`, async `mount` / deprecated `mountSync`, RxJS verbs (`select$`, `subscribe$`, `session$`), late-binding `inject` / `inject$` / `injectAll*`, `attach`, `serialize`, `defineToken` / `definePrivateToken`.
- Composition root at package entry with lazy DOM wiring (SSR-safe import).
- Workspace demo (`packages/demo`) and design corpus (`docs/next-version-deprecated/`).

### Changed

- **BREAKING**: Greenfield rewrite; v0.0.1 module paths (`/core`, `/bridge`, `/storage`, `/dom`, `/signals`) removed.
- **BREAKING**: `withBridge`, `withStorage`, `withProvider`, `withHook` replaced by `persist`, `provide*`, and named hooks (see migration guide).
- Monorepo uses a single root `pnpm-lock.yaml` for `packages/document-context`, `packages/demo`, and `packages/site`; install only from the repository root.
- RxJS is a required peer dependency (no longer optional).

### Removed

- Root `src/` feature-module tree (archived docs in `docs/archive/v0.0.1/`).
- Built-in bidirectional property bridge (`withBridge`).

[0.1.0-alpha.0]: https://github.com/sandlada/document-context/compare/v0.0.1-20261008.a...HEAD
