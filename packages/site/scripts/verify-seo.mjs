// Checks the built site for the search-metadata invariants that page
// components cannot enforce on their own.
//
// Runs after `astro build` through `npm run build`. The archived version
// directories come from `versions.json`, so a newly archived version is
// covered without touching this file.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readJsonFile } from '../lib/io.mjs';
import { apiPages, distDirectory, siteDescription, siteUrl, versionsFile } from '../lib/site.mjs';

if (!existsSync(distDirectory)) {
    console.error('verify:seo: dist/ does not exist. Run `npm run build` first.');
    process.exit(1);
}

const versions = readJsonFile(versionsFile).versions;

const skippedDirectories = new Set(['_astro', 'pagefind']);
const fallbackDescription = siteDescription;

const problems = [];
const fail = (message) => problems.push(message);

const pages = collectPages(distDirectory);
const sitemapUrls = new Set(readSitemapUrls(distDirectory));

if (pages.length === 0) {
    fail('No HTML pages found in dist/. Did the build run?');
}

checkRequiredFiles();
checkSitemap();
checkCrawledPages();

if (problems.length > 0) {
    console.error(`verify:seo found ${problems.length} problem(s):\n`);

    for (const problem of problems) {
        console.error(`  - ${problem}`);
    }

    process.exit(1);
}

console.log(
    `verify:seo checked ${pages.length} pages: titles, descriptions, canonicals, social images, JSON-LD and indexability are consistent.`,
);

function collectPages(directory) {
    const pages = [];

    for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);

        if (statSync(path).isDirectory()) {
            if (!skippedDirectories.has(entry)) {
                pages.push(...collectPages(path));
            }

            continue;
        }

        if (entry === 'index.html' || entry === '404.html') {
            pages.push(path);
        }
    }

    return pages;
}

function readSitemapUrls(directory) {
    const sitemapFiles = readdirSync(directory).filter((file) =>
        /^sitemap(-\d+)?\.xml$/.test(file),
    );

    if (sitemapFiles.length === 0) {
        fail('dist/sitemap-*.xml is missing. Is the sitemap integration configured?');

        return [];
    }

    return sitemapFiles.flatMap((file) => {
        const xml = readFileSync(join(directory, file), 'utf8');

        return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    });
}

function checkRequiredFiles() {
    const required = ['robots.txt', 'favicon.svg', 'og.png', 'apple-touch-icon.png'];

    for (const file of required) {
        if (!existsSync(join(distDirectory, file))) {
            fail(`dist/${file} is missing; the head of every page references it.`);
        }
    }

    if (existsSync(join(distDirectory, 'robots.txt'))) {
        const robots = readFileSync(join(distDirectory, 'robots.txt'), 'utf8');

        if (!robots.includes(`Sitemap: ${siteUrl}/sitemap-index.xml`)) {
            fail(`dist/robots.txt does not point at ${siteUrl}/sitemap-index.xml.`);
        }
    }
}

function checkSitemap() {
    const expected = new Set(
        pages
            .filter((page) => !isNonIndexable(page))
            .map((page) => `${siteUrl}${pageUrl(page)}`),
    );

    for (const url of sitemapUrls) {
        const path = new URL(url).pathname;

        if (archivedVersionSlugs().some((slug) => path.startsWith(`/${slug}/`))) {
            fail(`The sitemap includes the archived version page ${url}.`);
        }

        if (!expected.has(url)) {
            fail(`The sitemap lists ${url}, which is not an indexable page of the build.`);
        }

        const file = join(distDirectory, ...path.split('/').filter(Boolean), 'index.html');

        if (!existsSync(file)) {
            fail(`The sitemap lists ${url}, but dist has no HTML file for it.`);
        }
    }

    for (const url of expected) {
        if (!sitemapUrls.has(url)) {
            fail(`The indexable page ${url} is missing from the sitemap.`);
        }
    }
}

function checkCrawledPages() {
    const titles = new Map();
    const descriptions = new Map();

    for (const page of pages) {
        const url = pageUrl(page);
        const html = readFileSync(page, 'utf8');
        const tag = relative(distDirectory, page).split(sep).join('/');
        const title = firstTag(html, 'title')?.text?.trim();
        const meta = collectTags(html, 'meta');
        const links = collectTags(html, 'link');
        const description = meta.find(({ attrs }) => attrs.name === 'description')?.attrs.content;
        const robots = meta.find(({ attrs }) => attrs.name === 'robots')?.attrs.content ?? '';
        const nonIndexable = isNonIndexable(page);

        if (!title) {
            fail(`${tag} has no <title>.`);
        }

        if (!description) {
            fail(`${tag} has no meta description.`);
        } else if (description.length > 160) {
            fail(`${tag} has a ${description.length}-character description (max 160).`);
        }

        if (nonIndexable) {
            if (!robots.includes('noindex')) {
                fail(`${tag} must carry a noindex robots meta tag.`);
            }

            continue;
        }

        if (robots.includes('noindex')) {
            fail(`${tag} is indexable but carries a noindex robots meta tag.`);
        }

        const canonical = links.find(({ attrs }) => attrs.rel === 'canonical')?.attrs.href;

        if (canonical !== `${siteUrl}${url}`) {
            fail(`${tag} has canonical "${canonical ?? 'missing'}" instead of "${siteUrl}${url}".`);
        }

        const ogImage = meta.find(({ attrs }) => attrs.property === 'og:image')?.attrs.content;

        if (ogImage !== `${siteUrl}/og.png`) {
            fail(`${tag} has og:image "${ogImage ?? 'missing'}" instead of "${siteUrl}/og.png".`);
        }

        const ogType = meta.find(({ attrs }) => attrs.property === 'og:type')?.attrs.content;

        if (url === '/' ? ogType !== 'website' : ogType !== 'article') {
            fail(`${tag} has og:type "${ogType ?? 'missing'}" for the ${url} page.`);
        }

        const schemaTypes = checkJsonLd(html, tag);

        if (url !== '/' && !schemaTypes.includes('TechArticle')) {
            fail(`${tag} is missing the TechArticle JSON-LD block.`);
        }

        if (url.startsWith('/api/') && url !== '/api/' && !schemaTypes.includes('BreadcrumbList')) {
            fail(`${tag} is missing the BreadcrumbList JSON-LD block.`);
        }

        if (url.startsWith('/api/') && description === fallbackDescription) {
            fail(`${tag} still uses the site-wide description; the curated API metadata was not applied.`);
        }

        record(titles, title, url, tag, 'title');
        record(descriptions, description, url, tag, 'description');
    }

    checkApiPagesExist();
}

function checkApiPagesExist() {
    for (const module of Object.keys(apiPages)) {
        const file = join(distDirectory, 'api', ...(module === 'index' ? [] : [module]), 'index.html');

        if (!existsSync(file)) {
            fail(
                `seo-metadata.mjs registers the API page "${module}", but dist/api/${module}/ was not built. Remove the stale entry.`,
            );
        }
    }
}

function checkJsonLd(html, tag) {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];

    if (blocks.length === 0) {
        fail(`${tag} has no application/ld+json block.`);
    }

    const types = [];

    for (const [, content] of blocks) {
        let schema;

        try {
            schema = JSON.parse(content);
        } catch {
            fail(`${tag} contains an application/ld+json block that is not valid JSON.`);

            continue;
        }

        const { '@context': context, '@type': type } = schema;

        if (context !== 'https://schema.org') {
            fail(`${tag} has a JSON-LD block without the schema.org context.`);
        }

        if (typeof type !== 'string') {
            fail(`${tag} has a JSON-LD block without an @type.`);

            continue;
        }

        types.push(type);
    }

    return types;
}

function record(seen, value, url, tag, kind) {
    const previous = seen.get(value);

    if (previous && previous !== url) {
        fail(`${tag} reuses the ${kind} of ${previous}.`);
    }

    seen.set(value, url);
}

function isNonIndexable(page) {
    const url = pageUrl(page);

    return url === '/404/' || archivedVersionSlugs().some((slug) => url.startsWith(`/${slug}/`));
}

function archivedVersionSlugs() {
    return versions.map((version) => version.slug);
}

function pageUrl(page) {
    const relativePath = relative(distDirectory, page).split(sep).join('/');

    if (relativePath === 'index.html') {
        return '/';
    }

    return `/${relativePath.replace(/index\.html$/, '').replace(/404\.html$/, '404/')}`;
}

// Attribute values may themselves contain `<` and `>`, so a meta/link tag is
// only terminated by a `>` outside of a quoted value.
function collectTags(html, name) {
    const pattern = new RegExp(`<${name}\\s(?:[a-zA-Z-:]+="[^"]*"\\s*)*\\/?>`, 'g');

    return [...html.matchAll(pattern)].map(([tag]) => ({
        attrs: Object.fromEntries(
            [...tag.matchAll(/([a-zA-Z-:]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
        ),
    }));
}

function firstTag(html, name) {
    const match = html.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));

    return match ? { text: match[1] } : undefined;
}
