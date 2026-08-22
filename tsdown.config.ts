import { defineConfig } from 'tsdown'

export default defineConfig({
    entry: [
        'src/index.ts',
        'src/core/index.ts',
        'src/bridge/index.ts',
        'src/storage/index.ts',
        'src/dom/index.ts',
        'src/signals/index.ts'
    ],
    format: ['esm'],
    dts: {
        sourcemap: true
    },
    sourcemap: true,
    platform: 'browser',
    clean: true,
    outDir: 'build',
    tsconfig: 'tsconfig.build.json',
    unbundle: true
})
