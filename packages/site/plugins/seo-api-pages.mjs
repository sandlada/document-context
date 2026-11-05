// Applies the curated search metadata to the generated TypeDoc pages.
//
// `starlight-typedoc` rewrites `src/content/docs/api/` during its own
// `config:setup` hook and hardcodes the bare module name as the frontmatter
// title, without a description. This plugin is configured after it in the
// Starlight `plugins` array, so its `config:setup` runs once the pages exist
// and before content collections are loaded, and replaces those fields with
// the values registered in `lib/site.mjs`.
//
// A generated page without a registry entry fails the build: adding a subpath
// to the TypeDoc entry points must not silently ship a page that falls back to
// the site-wide description.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceFrontmatterFields } from '../lib/frontmatter.mjs';
import { apiPages } from '../lib/site.mjs';

const apiDirectory = fileURLToPath(new URL('../src/content/docs/api', import.meta.url));

function collectMarkdownFiles(dir, prefix = '') {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (entry.isDirectory()) {
            files.push(...collectMarkdownFiles(join(dir, entry.name), `${prefix}${entry.name}/`));
        } else if (entry.name.endsWith('.md')) {
            files.push(`${prefix}${entry.name.slice(0, -'.md'.length)}`);
        }
    }

    return files.sort();
}

const seoApiPages = {
    name: 'seo-api-pages',
    hooks: {
        'config:setup'({ logger }) {
            const modules = collectMarkdownFiles(apiDirectory);
            const missing = modules.filter((module) => !(module in apiPages));

            if (missing.length > 0) {
                throw new Error(
                    `Generated API pages without curated search metadata: ${missing.join(', ')}. ` +
                        'Add an entry to packages/site/lib/site.mjs (module name -> title and description).',
                );
            }

            for (const module of modules) {
                const { title, description } = apiPages[module];
                const path = join(apiDirectory, `${module}.md`);
                const contents = readFileSync(path, 'utf8');

                writeFileSync(
                    path,
                    replaceFrontmatterFields(
                        contents,
                        { title, description },
                        `Generated API page ${module}.md has no frontmatter to update.`,
                    ),
                );
            }

            logger.info(`Applied curated search metadata to ${modules.length} generated API pages.`);
        },
    },
};

export default seoApiPages;
