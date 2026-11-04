// Single source of truth for the documentation site: shared constants, the
// published module registry, and repository paths.
//
// Order of `moduleRegistry` matches the module map in the repository's
// AGENTS.md. Every module owns a spec at `src/<module>/README.md`. The
// derived exports keep the previous import shapes so existing consumers only
// need an import-path change:
//   - `modules` / `specDescriptions` feed the sidebar and the content sync;
//   - `entryPoints` drives TypeDoc generation and the API sidebar group;
//   - `apiPages` supplies the curated search metadata for generated API pages.
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const packageName = '@sandlada/document-context';

export const siteUrl = 'https://document-context.sandlada.com';

export const repositoryUrl = 'https://github.com/sandlada/document-context';

export const npmUrl = 'https://www.npmjs.com/package/@sandlada/document-context';

export const siteDescription =
    'Function-first IoC container and reactive state anchored to physical DOM nodes.';

export const packageKeywords = [
    'document-context',
    'inversion-of-control',
    'dependency-injection',
    'state-management',
    'w3c-context-protocol',
    'web-components',
];

const moduleRegistry = [
    {
        name: 'core',
        specDescription:
            'Pure blueprint operators and session verbs: createContext, pipe, mount, select, update and hooks.',
        apiTitle: 'Core: createContext, mount, update',
        apiDescription:
            'Blueprint and session verbs: createContext, pipe, mount, select, update, subscribe, dispose and hooks.',
    },
    {
        name: 'bridge',
        specDescription:
            'Bidirectional sync between state and DOM properties: dataset, style, aria and form values.',
        apiTitle: 'Bridge: withBridge property sync',
        apiDescription:
            'DOM bidirectional bridge: withBridge dot-path rules for dataset, style, aria and form values.',
    },
    {
        name: 'storage',
        specDescription:
            'Persistence adapters, hydration precedence, version migration and cross-tab sync.',
        apiTitle: 'Storage: withStorage hydration',
        apiDescription:
            'Persistence for document-context: withStorage adapters, hydration strategies and cross-tab sync.',
    },
    {
        name: 'dom',
        specDescription:
            'W3C Context Protocol scope: inject variants, ContextRequestEvent and observer GC.',
        apiTitle: 'DOM: inject, context-request',
        apiDescription:
            'W3C Context Protocol bindings: inject, injectAsync, injectAll plus observer-based zero-leak GC.',
    },
    {
        name: 'signals',
        specDescription:
            'TC39 Signals interop: adapt session state slices into fine-grained computed signals.',
        apiTitle: 'Signals: toSignal adapter',
        apiDescription:
            'TC39 Signals interop: toSignal adapts a session slice into a fine-grained computed signal.',
    },
];

export const modules = moduleRegistry.map((module) => module.name);

export const specDescriptions = Object.fromEntries(
    moduleRegistry.map((module) => [module.name, module.specDescription]),
);

// The TypeScript entry points documented in the API reference. Each one mirrors a
// published subpath export of `@sandlada/document-context`. The root barrel is not listed
// because it re-exports the same contracts as the subpaths without adding a
// runtime API of its own.
export const entryPoints = moduleRegistry.map((module) => `../src/${module.name}/index.ts`);

export const apiPages = {
    index: {
        title: 'API Reference',
        description: `Every export of the ${moduleRegistry.length} published @sandlada/document-context subpaths: core, bridge, storage, dom and signals.`,
    },
    ...Object.fromEntries(
        moduleRegistry.map((module) => [
            module.name,
            { title: module.apiTitle, description: module.apiDescription },
        ]),
    ),
};

export const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const repositoryRoot = resolve(siteRoot, '..');

export const contentDocsDirectory = join(siteRoot, 'src/content/docs');

export const specsDirectory = join(contentDocsDirectory, 'specs');

export const distDirectory = join(siteRoot, 'dist');

export const versionsFile = join(siteRoot, 'versions.json');
