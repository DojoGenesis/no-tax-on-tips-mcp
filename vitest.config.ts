import { defineConfig } from 'vitest/config';

// Scope test discovery to source only — vitest 4's defaults otherwise also collect
// the compiled *.test.js under dist/, double-running every test.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
