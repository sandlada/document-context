// Archives the current documentation as a versioned snapshot.
//
// starlight-versions archives the current docs into `src/content/docs/<slug>/`
// during `astro build` whenever a configured version has no directory yet. It
// runs after starlight-typedoc inside the same build, so the snapshot contains
// the API reference generated from the current source.
//
// The script is transactional: `versions.json` is only rewritten once the
// preconditions pass, and any build or verification failure restores
// `versions.json` and removes the archive directories created along the way,
// so the working tree is left exactly as it was found.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentDocsDirectory, siteRoot, versionsFile } from '../lib/site.mjs';

main();

function main() {
    const slug = process.argv[2];
    const label = process.argv[3] ?? `v${slug}`;

    if (!slug || slug.includes('/') || slug.includes('\\')) {
        console.error('Usage: node scripts/new-version.mjs <slug> [label]');
        console.error('Example: node scripts/new-version.mjs 0.20260811');
        process.exit(1);
    }

    const previousVersions = readFileSync(versionsFile, 'utf8');
    const versions = JSON.parse(previousVersions).versions;

    if (versions.some((version) => version.slug === slug)) {
        console.error(`Version '${slug}' is already configured.`);
        process.exit(1);
    }

    const archiveDirectory = join(contentDocsDirectory, slug);
    const archiveVersionsFile = join(contentDocsDirectory, '..', 'versions', `${slug}.json`);

    if (existsSync(archiveDirectory)) {
        console.error(`Version directory 'src/content/docs/${slug}/' already exists.`);
        process.exit(1);
    }

    writeFileSync(versionsFile, `${JSON.stringify({ versions: [{ slug, label }, ...versions] }, null, 4)}\n`);
    console.log(`Configured version '${slug}' (${label}) in site/versions.json.`);

    try {
        console.log('Archiving the current documentation...');
        runBuild();

        if (!existsSync(archiveDirectory)) {
            throw new Error(`Expected 'src/content/docs/${slug}/' to be created, but it is missing.`);
        }

        if (!existsSync(join(archiveDirectory, 'api'))) {
            throw new Error(`Expected 'src/content/docs/${slug}/api/' to be archived, but it is missing.`);
        }
    } catch (error) {
        writeFileSync(versionsFile, previousVersions);
        rmSync(archiveDirectory, { recursive: true, force: true });
        rmSync(archiveVersionsFile, { force: true });
        console.error(`version:new: ${error.message}`);
        console.error('The working tree was restored; no changes were left behind.');
        process.exit(1);
    }

    console.log(`
Archived the current documentation as '${slug}'.

Next steps:
  git add site/src/content/docs/${slug} site/src/content/versions/${slug}.json site/versions.json
  git commit -m "docs(site): archive documentation for ${label}"
`);
}

function runBuild() {
    // `npm_execpath` is set whenever npm runs this script, which lets the child
    // reuse the current Node binary without going through a shell. The fallback
    // keeps direct `node scripts/new-version.mjs` invocations working.
    if (process.env.npm_execpath) {
        execFileSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
            cwd: siteRoot,
            stdio: 'inherit',
        });

        return;
    }

    execFileSync('npm', ['run', 'build'], {
        cwd: siteRoot,
        shell: process.platform === 'win32',
        stdio: 'inherit',
    });
}
