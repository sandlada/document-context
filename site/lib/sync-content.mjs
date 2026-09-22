// Copies repository-level narrative documents into the Starlight content tree.
//
// The canonical files stay in the repository (docs/ and each module's
// README.md) so that readers of the source tree and readers of the published
// site see the same text. The generated copies are gitignored and rewritten by
// the content sync, which keeps them from drifting.
//
// Safety contract:
//   - everything renders to memory first; a missing source or a guard
//     violation aborts before any file is written;
//   - targets carry a generated marker, so hand-written files are never
//     overwritten (unless `force` is set) and pruning only deletes files this
//     sync owns;
//   - unchanged files are left untouched, keeping `mtime` stable.
//
// This module has no side effects on import; the CLI lives in
// `scripts/sync-content.mjs` and Astro runs `syncContent` from `config:setup`.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseFrontmatter, renderFrontmatter } from './frontmatter.mjs';
import { GENERATED_MARKER, pruneOwnedFiles, readJsonFile, writeFileIfChanged } from './io.mjs';
import {
    contentDocsDirectory,
    modules,
    repositoryRoot,
    repositoryUrl,
    siteRoot,
    specDescriptions,
    specsDirectory,
} from './site.mjs';

const repositoryFileURL = (file) => `${repositoryUrl}/blob/main/${file}`;

const narrativeDocuments = [
    {
        source: 'docs/core-concepts.md',
        target: 'src/content/docs/core-concepts.md',
        description:
            'Two-phase blueprint and mount model plus the data-last curried verbs behind every operation.',
    },
    {
        source: 'docs/lifecycles.md',
        target: 'src/content/docs/lifecycles.md',
        description:
            'Four cooperating lifecycles: DOM host, session state machine, services, and state bridge.',
    },
    {
        source: 'docs/w3c-protocol.md',
        target: 'src/content/docs/w3c-protocol.md',
        description:
            'W3C Context Protocol scope resolution across Shadow DOM, with streaming subscriptions.',
    },
];

function specDocuments() {
    return modules.map((module) => {
        const description = specDescriptions[module];

        if (!description) {
            throw new Error(
                `Missing spec description for module '${module}' in site/lib/site.mjs. ` +
                    'Add an entry so the synced /specs/ page has search metadata.',
            );
        }

        return {
            source: `src/${module}/README.md`,
            target: `src/content/docs/specs/${module}.md`,
            description,
        };
    });
}

/** Fails fast when the module registry drifted from the published subpaths. */
function validateRegistry() {
    const manifest = readJsonFile(join(repositoryRoot, 'package.json'));
    const exported = Object.keys(manifest.exports ?? {})
        .filter((subpath) => subpath !== '.' && subpath !== './package.json')
        .map((subpath) => subpath.replace(/^\.\//, ''))
        .sort();
    const registered = [...modules].sort();
    const problems = [];

    for (const name of exported) {
        if (!registered.includes(name)) {
            problems.push(
                `package.json exports "./${name}" but site/lib/site.mjs registers no such module.`,
            );
        }
    }

    for (const name of registered) {
        if (!exported.includes(name)) {
            problems.push(
                `site/lib/site.mjs registers module '${name}' but package.json has no "./${name}" export.`,
            );
        }

        if (!existsSync(join(repositoryRoot, 'src', name, 'index.ts'))) {
            problems.push(`site/lib/site.mjs registers module '${name}' but src/${name}/index.ts is missing.`);
        }
    }

    if (problems.length > 0) {
        throw new Error(`Module registry is out of sync:\n  - ${problems.join('\n  - ')}`);
    }
}

// Repository-relative links do not resolve inside the published site. Resolve
// each target against the source file's directory and map it:
//   - synced narrative guides and sibling module specs stay internal;
//   - every other repository file points at its GitHub page.
// Fragments are kept; GitHub and Starlight resolve the anchor themselves.
// Fenced code blocks are left alone so examples showing markdown stay intact.
function rewriteRepositoryLinks(markdown, sourcePath) {
    const sourceDirectory = dirname(sourcePath);
    const lines = markdown.split('\n');
    let fence = null;

    return lines
        .map((line) => {
            const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);

            if (fenceMatch) {
                const marker = fenceMatch[1][0];

                if (fence === null) {
                    fence = marker;
                } else if (fence === marker) {
                    fence = null;
                }

                return line;
            }

            if (fence !== null) {
                return line;
            }

            return line.replaceAll(/\]\(([^)\s]+)\)/g, (match, target) => {
                if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) {
                    return match;
                }

                const [path, ...fragments] = target.split('#');
                const fragment = fragments.length > 0 ? `#${fragments.join('#')}` : '';
                const resolved = relative(repositoryRoot, resolve(sourceDirectory, path)).replaceAll(
                    '\\',
                    '/',
                );

                return `](${mapRepositoryTarget(resolved)}${fragment})`;
            });
        })
        .join('\n');
}

function mapRepositoryTarget(file) {
    const narrative = file.match(/^docs\/([a-z0-9-]+)\.md$/);

    if (narrative) {
        return `/${narrative[1]}/`;
    }

    const spec = file.match(/^src\/([a-z-]+)\/README\.md$/);

    if (spec) {
        return `/specs/${spec[1]}/`;
    }

    return repositoryFileURL(file);
}

function renderDocument(document) {
    const sourcePath = resolve(repositoryRoot, document.source);
    let source;

    try {
        source = readFileSync(sourcePath, 'utf8');
    } catch {
        throw new Error(
            `Source file '${document.source}' is missing (expected at ${sourcePath}).`,
        );
    }

    const { data, body } = parseFrontmatter(source);
    const heading = body.match(/^#\s+(.+)$/m);
    const title = data.title ?? (heading ? heading[1].trim() : document.source);

    // The source file's own H1 becomes the Starlight page title, so drop it from
    // the body to avoid rendering two top-level headings.
    const withoutHeading = heading ? body.replace(heading[0], '') : body;

    return (
        renderFrontmatter({ title, description: data.description ?? document.description }) +
        `${GENERATED_MARKER}\n\n` +
        rewriteRepositoryLinks(withoutHeading.trimStart(), sourcePath)
    );
}

/**
 * Renders every narrative document and writes the content tree. Returns the
 * `{ created, updated, unchanged, pruned }` counts. With `force`, targets
 * without a generated marker are overwritten instead of rejected.
 */
export function syncContent({ force = false } = {}) {
    validateRegistry();

    const documents = [...narrativeDocuments, ...specDocuments()];
    const rendered = documents.map((document) => ({
        document,
        contents: renderDocument(document),
    }));

    const violations = [];

    for (const { document } of rendered) {
        const targetPath = resolve(siteRoot, document.target);

        if (!force && existsSync(targetPath)) {
            const previous = readFileSync(targetPath, 'utf8');

            if (!previous.includes(GENERATED_MARKER)) {
                violations.push(
                    `'${document.target}' exists but was not generated by this sync. ` +
                        'Move it aside or re-run with --force to overwrite it.',
                );
            }
        }
    }

    if (violations.length > 0) {
        throw new Error(`Refusing to overwrite hand-written files:\n  - ${violations.join('\n  - ')}`);
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const { document, contents } of rendered) {
        const outcome = writeFileIfChanged(resolve(siteRoot, document.target), contents);

        if (outcome === 'created') {
            created += 1;
        } else if (outcome === 'updated') {
            updated += 1;
        } else {
            unchanged += 1;
        }

        console.log(`Synced ${document.source} -> site/${document.target} (${outcome})`);
    }

    const pruned = pruneOwnedFiles(
        specsDirectory,
        new Set(modules.map((module) => `${module}.md`)),
    );

    for (const file of pruned) {
        console.log(`Pruned stale generated page site/src/content/docs/specs/${file}`);
    }

    const prunedNarrative = pruneOwnedFiles(
        contentDocsDirectory,
        new Set([
            ...narrativeDocuments.map((document) => document.target.split('/').at(-1)),
            'getting-started.md',
            'index.mdx',
        ]),
    );

    for (const file of prunedNarrative) {
        console.log(`Pruned stale generated page site/src/content/docs/${file}`);
    }

    return { created, updated, unchanged, pruned: pruned.length + prunedNarrative.length };
}
