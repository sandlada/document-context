// Renders the committed social/icon PNGs from their SVG sources.
//
// The PNGs are committed and served from `public/`, so this script is a
// developer tool, not part of the build: running it requires a font stack for
// the SVG text and its output would not be byte-identical across machines.
// Re-run `npm run generate:icons` after editing `assets/og.svg` or
// `public/favicon.svg` and commit the regenerated PNGs.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { siteRoot } from '../lib/site.mjs';

const sources = {
    og: join(siteRoot, 'assets/og.svg'),
    favicon: join(siteRoot, 'public/favicon.svg'),
};

for (const [name, path] of Object.entries(sources)) {
    if (!existsSync(path)) {
        console.error(`generate:icons: source file for '${name}' is missing (expected at ${path}).`);
        process.exit(1);
    }
}

mkdirSync(join(siteRoot, 'public'), { recursive: true });

// Social preview card. Rendered denser than needed and downscaled so the text
// lands on the 1200x630 size every crawler expects.
const og = await sharp(sources.og, { density: 288 })
    .resize(1200, 630)
    .png({ compressionLevel: 9 })
    .toFile(join(siteRoot, 'public/og.png'));

// Apple touch icons are drawn as opaque squares; the rounded corners of the
// favicon glyph are flattened into the brand background.
const appleTouchIcon = await sharp(sources.favicon, { density: 288 })
    .resize(180, 180)
    .flatten({ background: '#00531f' })
    .png({ compressionLevel: 9 })
    .toFile(join(siteRoot, 'public/apple-touch-icon.png'));

console.log(`og.png            ${og.width}x${og.height}`);
console.log(`apple-touch-icon  ${appleTouchIcon.width}x${appleTouchIcon.height}`);
