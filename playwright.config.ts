import { defineConfig } from '@playwright/test';

// Smoke gate for /review and /implement. Not run in CI (browser install cost).
// Videos and traces are for the human: `npx playwright show-trace test-results/<dir>/trace.zip`.
export default defineConfig({
	testDir: './e2e',
	timeout: 120_000,
	fullyParallel: false,
	workers: 1,
	reporter: [['list']],
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'on',
		video: 'on',
		screenshot: 'on',
	},
	webServer: {
		command: 'npm run build && npm run preview -- --port 4173',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
	},
});
