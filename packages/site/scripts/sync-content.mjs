// CLI shell for the narrative content sync. The implementation lives in
// `lib/sync-content.mjs` so Astro can run it from `config:setup`; this file
// only parses flags and reports the outcome.
import { syncContent } from '../lib/sync-content.mjs';

const force = process.argv.includes('--force');

try {
    const { created, updated, unchanged, pruned } = syncContent({ force });

    console.log(
        `sync-content: ${created} created, ${updated} updated, ${unchanged} unchanged, ${pruned} pruned.`,
    );
} catch (error) {
    console.error(`sync-content: ${error.message}`);
    process.exit(1);
}
