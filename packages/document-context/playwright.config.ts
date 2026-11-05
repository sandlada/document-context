import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
    testDir: './test/browser',
    testMatch: /.*\.spec\.ts/,
    fullyParallel: false,
    workers: 1,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:5188',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'pnpm exec vite --config vite.browser.config.ts',
        url: 'http://127.0.0.1:5188/test/browser/index.html',
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
    },
})
