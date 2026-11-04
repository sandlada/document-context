// Per-route search metadata that cannot live in page frontmatter.
//
// The metadata every page shares (social image, theme color, verification
// tags) is configured once in `astro.config.mjs`. This route middleware adds
// the parts that depend on the rendered route:
//
// - `robots` for the two page groups that must stay out of the index: archived
//   documentation versions (frozen near-duplicates of the current pages) and
//   the 404 page.
// - `og:type` for the home page, which is a website rather than an article.
// - JSON-LD: `WebSite` and `SoftwareSourceCode` on the home page, a
//   `TechArticle` plus a `BreadcrumbList` on every other indexable page.
//
// Starlight route middleware is registered through the `routeMiddleware`
// config key. The file must not live at `src/middleware.ts`: that path is
// reserved for Astro middleware and Starlight rejects it.
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import type { StarlightRouteData } from '@astrojs/starlight/route-data';
import versions from '../versions.json';
import {
    npmUrl,
    packageKeywords,
    packageName,
    repositoryUrl,
    siteDescription,
} from '../lib/site.mjs';

type Head = StarlightRouteData['head'];
type HeadEntry = Head[number];
type Sidebar = StarlightRouteData['sidebar'];

interface Crumb {
    label: string;
    href: string;
}

const defaultRobots = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

const noindexRobots = 'noindex, follow';

const archivedVersionSlugs = (versions.versions as Array<{ slug: string }>).map(
    (version) => version.slug,
);

export const onRequest = defineRouteMiddleware((context) => {
    const { starlightRoute } = context.locals;
    const { entry, head } = starlightRoute;
    const isArchived = archivedVersionSlugs.some((slug) => entry.id === slug || entry.id.startsWith(`${slug}/`));
    const isNotFound = entry.id === '404' || entry.id.endsWith('/404');

    if (isArchived || isNotFound) {
        setMeta(head, { name: 'robots' }, noindexRobots);

        return;
    }

    setMeta(head, { name: 'robots' }, defaultRobots);

    if (!context.site) {
        return;
    }

    const title = entry.data.title;
    const description = entry.data.description ?? siteDescription;

    if (context.url.pathname === '/') {
        setMeta(head, { property: 'og:type' }, 'website');
        pushJsonLd(head, websiteSchema(context.site.origin, title, description));
        pushJsonLd(head, softwareSourceCodeSchema(description));

        return;
    }

    pushJsonLd(
        head,
        techArticleSchema({
            url: new URL(context.url.pathname, context.site).href,
            origin: context.site.origin,
            title,
            description,
        }),
    );

    const crumbs = breadcrumbTrail(starlightRoute, context.url.pathname);

    if (crumbs.length > 1) {
        pushJsonLd(head, breadcrumbSchema(crumbs, context.site.origin));
    }
});

function setMeta(head: Head, attrs: Record<string, string>, content: string) {
    const existing = head.find(
        (entry: HeadEntry) =>
            entry.tag === 'meta' &&
            entry.attrs !== undefined &&
            Object.entries(attrs).every(([key, value]) => entry.attrs?.[key] === value),
    );

    if (existing?.attrs) {
        existing.attrs = { ...existing.attrs, content };

        return;
    }

    head.push({ tag: 'meta', attrs: { ...attrs, content } });
}

function pushJsonLd(head: Head, schema: Record<string, unknown>) {
    head.push({
        tag: 'script',
        attrs: { type: 'application/ld+json' },
        content: JSON.stringify(schema),
    });
}

/** Sidebar trail of the current page, starting at the home page. */
function breadcrumbTrail(route: StarlightRouteData, pathname: string): Crumb[] {
    const crumbs: Crumb[] = [{ label: 'Home', href: '/' }];

    for (const link of findCurrentTrail(route.sidebar, [])) {
        if (!crumbs.some((crumb) => crumb.href === link.href)) {
            crumbs.push(link);
        }
    }

    // Sidebar groups have no page of their own, so the API section would be
    // missing from the trail: point it at its index instead.
    if (pathname === '/api/') {
        crumbs.push({ label: 'API Reference', href: '/api/' });
    } else if (pathname.startsWith('/api/') && !crumbs.some((crumb) => crumb.href === '/api/')) {
        crumbs.splice(crumbs.length - 1, 0, { label: 'API Reference', href: '/api/' });
    }

    return crumbs;
}

function findCurrentTrail(entries: Sidebar, trail: Crumb[]): Crumb[] {
    for (const entry of entries) {
        if (entry.type === 'link' && entry.isCurrent) {
            return [...trail, { label: entry.label, href: entry.href }];
        }

        if (entry.type === 'group') {
            const nested = findCurrentTrail(entry.entries, trail);

            if (nested.length > trail.length) {
                return nested;
            }
        }
    }

    return trail;
}

function websiteSchema(origin: string, title: string, description: string) {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: packageName,
        url: `${origin}/`,
        description: description || title,
        inLanguage: 'en',
    };
}

function softwareSourceCodeSchema(description: string) {
    return {
        '@context': 'https://schema.org',
        '@type': 'SoftwareSourceCode',
        name: packageName,
        description,
        codeRepository: repositoryUrl,
        programmingLanguage: 'TypeScript',
        license: 'https://opensource.org/license/mit',
        keywords: packageKeywords.join(', '),
        sameAs: [npmUrl, repositoryUrl],
    };
}

function techArticleSchema(input: {
    url: string;
    origin: string;
    title: string;
    description: string;
}) {
    return {
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: input.title,
        description: input.description,
        url: input.url,
        inLanguage: 'en',
        isPartOf: {
            '@type': 'WebSite',
            name: packageName,
            url: `${input.origin}/`,
        },
    };
}

function breadcrumbSchema(crumbs: Crumb[], origin: string) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((crumb, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: crumb.label,
            item: new URL(crumb.href, origin).href,
        })),
    };
}
