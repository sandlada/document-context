import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
    base: './',
    root,
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: resolve(root, 'index.html'),
                counter: resolve(root, 'pages/counter.html'),
                di: resolve(root, 'pages/di.html'),
                'late-binding': resolve(root, 'pages/late-binding.html'),
                persist: resolve(root, 'pages/persist.html'),
            },
        },
    },
})
