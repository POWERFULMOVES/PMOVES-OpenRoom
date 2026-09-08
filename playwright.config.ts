import { defineConfig, devices } from '@playwright/test';

// Port 3000 is not free on a PMOVES node: `pmoves-supabase-postgrest-1`
// publishes 127.0.0.1:3000. `reuseExistingServer` is true outside CI, so
// Playwright probes the URL, sees PostgREST answer (401), concludes a dev
// server is already up, SKIPS `pnpm dev`, and runs every spec against
// PostgREST. All 9 fail at `toHaveTitle` receiving "" -- a failure that
// names the app and measures a database gateway.
//
// Measured on PMOVES-4090 2026-09-08. Overridable so a node whose 3987 is
// also taken can move it without editing this file.
const PORT = Number(process.env.OPENROOM_E2E_PORT ?? 3987);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Invoke vite directly in the app's own directory.
    //
    // Two routes were tried and both drop the flag: `pnpm dev --port` sends it
    // to `turbo run dev`, which rejects it outright; `pnpm --filter <pkg> dev --
    // --port` is swallowed and vite still came up on 3000. Playwright's own
    // `cwd` option removes the two wrappers between here and the flag.
    //
    // `--strictPort` is deliberate. Vite's default is to walk to the next free
    // port, which is how a run ends up green against a server nobody meant to
    // test. Fail instead, and say which port.
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: 'apps/webuiapps',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // 30s did not cover a cold vite start on this node. Raised rather than
    // left to fail as "the app is broken", which is what a webServer start
    // timeout reads like at a glance.
    timeout: 120_000,
  },
});
