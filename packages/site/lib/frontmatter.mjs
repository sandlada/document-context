// Shared frontmatter helpers for the site's content pipeline.
//
// Both the narrative sync (`lib/sync-content.mjs`) and the generated-API
// metadata plugin (`plugins/seo-api-pages.mjs`) read and rewrite YAML
// frontmatter. They share these functions so the parsing rules cannot drift:
// values are emitted with `JSON.stringify`, which produces a YAML
// double-quoted scalar, valid for titles and descriptions.

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const FIELD_PATTERN = /^([A-Za-z][\w-]*):\s*(.*)$/;

function fieldKey(line) {
    const match = line.match(FIELD_PATTERN);

    return match ? match[1] : undefined;
}

function stripQuotes(value) {
    return value.replace(/^['"]|['"]$/g, '');
}

/**
 * Splits a markdown document into its frontmatter fields and body. Documents
 * without a frontmatter block return an empty `data` object and the full
 * markdown as `body`.
 */
export function parseFrontmatter(markdown) {
    const match = markdown.match(FRONTMATTER_PATTERN);

    if (!match) {
        return { data: {}, body: markdown };
    }

    const data = {};

    for (const line of match[1].split(/\r?\n/)) {
        const key = fieldKey(line);

        if (key) {
            data[key] = stripQuotes(line.slice(key.length + 1).trim());
        }
    }

    return { data, body: markdown.slice(match[0].length) };
}

/** Renders frontmatter fields as a `---` block, including the trailing blank line. */
export function renderFrontmatter(values) {
    const lines = Object.entries(values).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);

    return `---\n${lines.join('\n')}\n---\n\n`;
}

/**
 * Replaces the given frontmatter fields of a markdown document, keeping every
 * other field and the body untouched. New values are emitted first, in the
 * insertion order of `fields`. Throws when the document has no frontmatter
 * block.
 */
export function replaceFrontmatterFields(markdown, fields, missingMessage) {
    const match = markdown.match(FRONTMATTER_PATTERN);

    if (!match) {
        throw new Error(missingMessage ?? 'Document has no frontmatter to update.');
    }

    const replaced = new Set(Object.keys(fields));
    const kept = match[1]
        .split(/\r?\n/)
        .filter((line) => !replaced.has(fieldKey(line)));
    const updated = [
        ...Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
        ...kept,
    ];

    return `---\n${updated.join('\n')}\n---\n${markdown.slice(match[0].length)}`;
}
