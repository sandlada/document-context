import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import {
    currentDemosDirectory,
    currentVendorDirectory,
    packageRoot,
    srcDemosDirectory,
} from './site.mjs';

const require = createRequire(import.meta.url);
const rxjsPkgPath = require.resolve('rxjs/package.json');
const rxjsDir = dirname(rxjsPkgPath);
const rxjsEntry = join(rxjsDir, 'dist/esm/index.js');
const rxjsOperatorsEntry = join(rxjsDir, 'dist/esm/operators/index.js');

const IMPORT_MAP = {
    imports: {
        'rxjs': './vendor/rxjs.js',
        'rxjs/operators': './vendor/rxjs-operators.js',
        '@sandlada/document-context': './vendor/document-context.js',
        '@sandlada/document-context/domain': './vendor/document-context-domain.js',
        '@sandlada/document-context/application': './vendor/document-context-application.js',
        '@sandlada/document-context/infrastructure/dom': './vendor/document-context-infrastructure-dom.js',
        '@sandlada/document-context/infrastructure/ssr': './vendor/document-context-infrastructure-ssr.js',
    },
};

const COMMON_BRIDGE_SCRIPT = `
<script>
(function() {
    function applyTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            document.documentElement.setAttribute('data-theme', 'light');
        }
    }
    window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'set-theme') {
            applyTheme(e.data.theme);
        }
    });
    try {
        var parentTheme = window.parent !== window && window.parent.document.documentElement.getAttribute('data-theme');
        if (parentTheme) {
            applyTheme(parentTheme);
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            applyTheme('dark');
        }
    } catch(e) {}
})();
</script>
`;

/**
 * Builds the standalone browser ESM bundle for the current library and rxjs,
 * then syncs and prepares HTML demo sandboxes in public/demos/current/.
 */
export async function syncDemos() {
    mkdirSync(currentVendorDirectory, { recursive: true });

    console.log('Building demo vendor runtime bundle...');
    await build({
        configFile: false,
        publicDir: false,
        logLevel: 'warn',
        build: {
            outDir: currentVendorDirectory,
            emptyOutDir: false,
            minify: false,
            rollupOptions: {
                input: {
                    'document-context': join(packageRoot, 'src/index.ts'),
                    'document-context-domain': join(packageRoot, 'src/domain/index.ts'),
                    'document-context-application': join(packageRoot, 'src/application/index.ts'),
                    'document-context-infrastructure-dom': join(packageRoot, 'src/infrastructure/dom/index.ts'),
                    'document-context-infrastructure-ssr': join(packageRoot, 'src/infrastructure/ssr/index.ts'),
                    'rxjs': rxjsEntry,
                    'rxjs-operators': rxjsOperatorsEntry,
                },
                output: {
                    format: 'es',
                    entryFileNames: '[name].js',
                    chunkFileNames: 'chunks/[name]-[hash].js',
                },
                preserveEntrySignatures: 'allow-extension',
            },
        },
    });

    if (!existsSync(srcDemosDirectory)) {
        mkdirSync(srcDemosDirectory, { recursive: true });
    }

    // Sync MD3 theme css
    const md3Src = join(srcDemosDirectory, 'md3-theme.css');
    if (existsSync(md3Src)) {
        writeFileSync(join(currentDemosDirectory, 'md3-theme.css'), readFileSync(md3Src, 'utf8'), 'utf8');
        console.log('Synced MD3 theme CSS -> public/demos/current/md3-theme.css');
    }

    const demoFiles = readdirSync(srcDemosDirectory).filter((file) => file.endsWith('.html'));

    for (const file of demoFiles) {
        const srcPath = join(srcDemosDirectory, file);
        const destPath = join(currentDemosDirectory, file);
        const rawHtml = readFileSync(srcPath, 'utf8');

        const transformedHtml = transformDemoHtml(rawHtml);
        writeFileSync(destPath, transformedHtml, 'utf8');
        console.log(`Synced demo sandbox: src/demos/${file} -> public/demos/current/${file}`);
    }
}

function transformDemoHtml(html) {
    const importMapScript = `<script type="importmap">\n${JSON.stringify(IMPORT_MAP, null, 4)}\n</script>`;
    const md3Stylesheet = `<link rel="stylesheet" href="./md3-theme.css" />`;

    // If an importmap is already in the document, replace it; otherwise prepend to head
    let output = html;
    if (/<script\s+type=["']importmap["']>[\s\S]*?<\/script>/i.test(output)) {
        output = output.replace(/<script\s+type=["']importmap["']>[\s\S]*?<\/script>/i, importMapScript);
    } else if (/<head>/i.test(output)) {
        output = output.replace(/<head>/i, `<head>\n    ${importMapScript}`);
    } else {
        output = `${importMapScript}\n${output}`;
    }

    if (!output.includes('md3-theme.css')) {
        if (/<head>/i.test(output)) {
            output = output.replace(/<head>/i, `<head>\n    ${md3Stylesheet}`);
        } else {
            output = `${md3Stylesheet}\n${output}`;
        }
    }

    if (!output.includes('applyTheme(theme)')) {
        if (/<\/head>/i.test(output)) {
            output = output.replace(/<\/head>/i, `    ${COMMON_BRIDGE_SCRIPT}\n</head>`);
        } else {
            output = `${COMMON_BRIDGE_SCRIPT}\n${output}`;
        }
    }

    return output;
}

// Allow direct execution: `node lib/sync-demos.mjs`
if (process.argv[1] && process.argv[1].endsWith('sync-demos.mjs')) {
    syncDemos().catch((error) => {
        console.error('sync-demos failed:', error);
        process.exit(1);
    });
}
