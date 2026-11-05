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
        name: 'domain',
        specDescription:
            'Pure domain model, ports, and use cases — no DOM, no I/O.',
        apiTitle: 'Domain layer exports',
        apiDescription:
            'Scope model, service tokens, lifecycle types, and use-case contracts for @sandlada/document-context.',
    },
    {
        name: 'application',
        specDescription:
            'Blueprint operators, session verbs, dependency injection, and RxJS-facing API.',
        apiTitle: 'Application layer exports',
        apiDescription:
            'createContext, pipe, mount, update, provide, inject, subscribe, and related session verbs.',
    },
    {
        name: 'infrastructure/dom',
        specDescription:
            'DOM host adapters, W3C Context Protocol transport, observer lifecycle, and late binding.',
        apiTitle: 'Infrastructure: DOM',
        apiDescription:
            'Mount boundary, scope resolution, ContextRequestEvent transport, and zero-leak observer wiring.',
    },
    {
        name: 'infrastructure/ssr',
        specDescription:
            'SSR serialization, null host, and hydration payload resolution.',
        apiTitle: 'Infrastructure: SSR',
        apiDescription:
            'Serialize and restore session state across server render and client hydration.',
    },
];

export const modules = moduleRegistry.map((module) => module.name);

export const specDescriptions = Object.fromEntries(
    moduleRegistry.map((module) => [module.name, module.specDescription]),
);

export const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const repositoryRoot = resolve(siteRoot, '../..');

export const packageRoot = join(repositoryRoot, 'packages/document-context');

// The TypeScript entry points documented in the API reference. Each one mirrors a
// published subpath export of `@sandlada/document-context`. The root barrel is not listed
// because it re-exports the same contracts as the subpaths without adding a
// runtime API of its own.
export const entryPoints = moduleRegistry.map(
    (module) => `../document-context/src/${module.name}/index.ts`,
);

export const apiPages = {
    index: {
        title: 'API Reference',
        description: `Every export of the ${moduleRegistry.length} published @sandlada/document-context subpaths.`,
    },
    ...Object.fromEntries(
        moduleRegistry.map((module) => [
            module.name,
            { title: module.apiTitle, description: module.apiDescription },
        ]),
    ),
};

export const contentDocsDirectory = join(siteRoot, 'src/content/docs');

export const specsDirectory = join(contentDocsDirectory, 'specs');

export const distDirectory = join(siteRoot, 'dist');

export const versionsFile = join(siteRoot, 'versions.json');

export const srcDemosDirectory = join(siteRoot, 'src/demos');

export const publicDemosDirectory = join(siteRoot, 'public/demos');

export const currentDemosDirectory = join(publicDemosDirectory, 'current');

export const currentVendorDirectory = join(currentDemosDirectory, 'vendor');
