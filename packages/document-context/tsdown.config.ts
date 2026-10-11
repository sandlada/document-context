import { defineConfig } from 'tsdown'

export default defineConfig({
    entry: {
        'index': 'src/index.ts',
        'domain/index': 'src/domain/index.ts',
        'application/index': 'src/application/index.ts',
        'infrastructure/dom/index': 'src/infrastructure/dom/index.ts',
        'infrastructure/storage/index': 'src/infrastructure/storage/index.ts',
        'infrastructure/ssr/index': 'src/infrastructure/ssr/index.ts'
    },
    format: ['esm'],
    dts: {
        sourcemap: true
    },
    sourcemap: true,
    platform: 'neutral',
    clean: true,
    outDir: 'build',
    tsconfig: 'tsconfig.build.json',
    unbundle: true
})
