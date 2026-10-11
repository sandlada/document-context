import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        projects: [
            {
                test: {
                    name: 'domain',
                    environment: 'node',
                    include: ['src/domain/**/*.test.ts']
                }
            }
        ],
        coverage: {
            provider: 'v8',
            reporter: ['json', 'html'],
            exclude: [
                'src/domain/testing/**'
            ]
        }
    }
})
