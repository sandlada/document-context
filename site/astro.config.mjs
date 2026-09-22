import { readFileSync } from 'node:fs';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import starlightTypeDoc from 'starlight-typedoc';
import starlightVersions from 'starlight-versions';
import seoApiPages from './plugins/seo-api-pages.mjs';
import overloadCodeblocks from './plugins/overload-codeblocks.mjs';
import { entryPoints, modules, packageName, siteDescription, siteUrl } from './lib/site.mjs';
import { resolveSourceRevision } from './lib/source-revision.mjs';
import { syncContent } from './lib/sync-content.mjs';

const { versions } = JSON.parse(readFileSync(new URL('./versions.json', import.meta.url), 'utf8'));

const sourceRevision = resolveSourceRevision();

// starlight-typedoc only fills its sidebar group for the default per-member file
// layout: it turns each kind group ("Functions", "Interfaces", …) into an
// `autogenerate` entry over a directory that only exists in that layout. With
// `outputFileStrategy: 'modules'` every module is a single page, so the group it
// generates for a module contains nothing. The group is built here instead, from the
// same entry point list that drives generation, which also means every entry is a
// link the link validator checks.
const apiSidebarGroup = {
    label: 'API Reference',
    items: entryPoints.map((entryPoint) => {
        const module = entryPoint.split('/').at(-2);

        return { label: module, link: `/api/${module}/` };
    }),
};

// Search-engine ownership checks are supplied by the build environment, so the
// tokens stay out of the repository. Set them on the Workers Builds project.
const verificationMeta = (name, token) =>
    token ? [{ tag: 'meta', attrs: { name, content: token } }] : [];

// Tags every page needs. Route-dependent metadata (robots, JSON-LD, og:type on
// the home page) is added by `src/starlightRouteData.ts`.
const head = [
    { tag: 'meta', attrs: { property: 'og:image', content: `${siteUrl}/og.png` } },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
    {
        tag: 'meta',
        attrs: {
            property: 'og:image:alt',
            content: `${packageName}: ${siteDescription}`,
        },
    },
    { tag: 'meta', attrs: { name: 'twitter:image', content: `${siteUrl}/og.png` } },
    { tag: 'meta', attrs: { name: 'theme-color', content: '#00531f' } },
    { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
    { tag: 'script', attrs: { src: '/header-controller.js', defer: true } },
    ...verificationMeta('google-site-verification', process.env.GOOGLE_SITE_VERIFICATION),
    ...verificationMeta('msvalidate.01', process.env.BING_SITE_VERIFICATION),
];

export default defineConfig({
    site: siteUrl,
    trailingSlash: 'always',
    output: 'static',
    devToolbar: { enabled: false },
    integrations: [
        starlight({
            title: '@sandlada/document-context',
            description: siteDescription,
            customCss: ['./src/styles/custom.css'],
            lastUpdated: true,
            head,
            routeMiddleware: ['./src/starlightRouteData.ts'],
            editLink: {
                baseUrl: 'https://github.com/sandlada/document-context/edit/main/site/',
            },
            social: [
                { icon: 'github', label: 'GitHub', href: 'https://github.com/sandlada/document-context' },
            ],
            plugins: [
                // Syncs the narrative pages first, so every Astro entry point
                // (dev/build/check/sync) sees generated content without an
                // explicit `npm run sync` step.
                {
                    name: 'sync-content',
                    hooks: {
                        'config:setup': () => {
                            syncContent();
                        },
                    },
                },
                starlightTypeDoc({
                    entryPoints,
                    tsconfig: '../tsconfig.json',
                    output: 'api',
                    typeDoc: {
                        outputFileStrategy: 'modules',
                        entryFileName: 'index',
                        useHTMLEncodedBrackets: true,
                        // Parameters, type parameters and properties render as
                        // tables instead of one heading per field, which keeps
                        // short signature sections dense.
                        parametersFormat: 'table',
                        interfacePropertiesFormat: 'table',
                        classPropertiesFormat: 'table',
                        typeAliasPropertiesFormat: 'table',
                        typeDeclarationFormat: 'table',
                        indexFormat: 'table',
                        // Member pages keep their own "Defined in" line, so the
                        // per-row source column in property tables only repeats it.
                        tableColumnSettings: { hideSources: true },
                        // Keeps every "Defined in" reference resolvable; see lib/source-revision.mjs.
                        gitRevision: sourceRevision,
                        // The project name becomes the title of the generated module index,
                        // so it reads "API Reference" instead of repeating the site title.
                        name: 'API Reference',
                        // JSDoc prose such as `Promise<boolean>` is invalid MDX, and
                        // starlight-versions parses every page with remark-mdx when it
                        // archives a version. Sanitising the comments keeps generated
                        // pages parseable without constraining how JSDoc is written.
                        sanitizeComments: true,
                    },
                }),
                // Collapses every Call Signature table into the source overload
                // block, so the archived copy inherits the compact layout.
                overloadCodeblocks,
                // Runs after starlightTypeDoc regenerated the API pages and before
                // starlightVersions archives them, so curated metadata is what gets
                // archived as well.
                seoApiPages,
                // No archived versions yet (versions.json is empty): skip the
                // versions plugin until `npm run version:new` creates the first
                // snapshot, since it requires at least one version.
                ...(versions.length > 0 ? [starlightVersions({ versions })] : []),
                starlightLinksValidator(),
            ],
            sidebar: [
                { label: 'Start Here', items: ['getting-started', 'core-concepts'] },
                { label: 'Guides', items: ['lifecycles', 'w3c-protocol'] },
                { label: 'Module specs', items: modules.map((module) => `specs/${module}`) },
                apiSidebarGroup,
            ],
        }),
        mdx(),
        sitemap({
            // Archived versions stay reachable but are kept out of the index:
            // they duplicate the current pages and carry a `noindex` robots tag.
            filter: (page) =>
                !versions.some((version) => new URL(page).pathname.startsWith(`/${version.slug}/`)),
        }),
    ],
});
