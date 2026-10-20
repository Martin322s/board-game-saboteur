import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  plugins: [react(), tailwindcss()],
  test: {
    // Only fast, local unit/component projects live here (TEST_STRATEGY.md Tier A/B).
    // Integration, database, E2E and simulation suites get their own projects/configs later
    // and are never part of the default run.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit-domain',
          include: ['src/domain/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'unit-ui',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/domain/**'],
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      {
        // Host-neutral Edge Function code (handler, HTTP layer). No network, no database.
        extends: true,
        test: {
          name: 'unit-backend',
          include: ['supabase/functions/**/*.test.ts'],
          exclude: ['supabase/functions/_shared/domain/**'],
          environment: 'node',
        },
      },
      {
        // Real authoritative pipeline against a migrated Postgres (DATABASE_URL). Never part of
        // test:unit / test:fast; run via `npm run test:backend:docker`.
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
