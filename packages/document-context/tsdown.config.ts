import { defineConfig } from 'tsdown'

export default defineConfig({
    entry: {
        'domain/index': 'src/domain/index.ts'
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
