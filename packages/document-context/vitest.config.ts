import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        projects: [
            {
                test: {
                    name: 'unit',
                    environment: 'node',
                    include: ['src/**/*.unit-test.ts']
                }
            },
            {
                test: {
                    name: 'integration',
                    environment: 'happy-dom',
                    include: ['test/integration/**/*.integration-test.ts']
                }
            },
            {
                test: {
                    name: 'e2e',
                    environment: 'happy-dom',
                    include: ['test/e2e/**/*.e2e-test.ts']
                }
            }
        ],
        coverage: {
            provider: 'v8',
            reporter: ['json', 'html'],
            exclude: [
                'src/testing/**',
                'src/**/testing/**'
            ]
        }
    }
})
