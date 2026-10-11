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
            },
            {
                test: {
                    name: 'application',
                    environment: 'node',
                    include: ['src/application/**/*.test.ts']
                }
            },
            {
                test: {
                    name: 'infrastructure',
                    environment: 'happy-dom',
                    include: ['src/infrastructure/**/*.test.ts', 'src/index.test.ts']
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
