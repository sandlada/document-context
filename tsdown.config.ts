import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    platform: 'browser',
    clean: true,
    outDir: 'build',
});
