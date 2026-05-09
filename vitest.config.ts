import { defineConfig } from 'vitest/config';

// Vitest config kept separate from vite.config.ts to avoid type collisions
// between the project's Vite 6 and Vitest 2's nested Vite.
// See: https://github.com/vitest-dev/vitest/issues/4567
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
