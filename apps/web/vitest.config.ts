import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// The web app's own Vite config pulls in the React plugin and the dev proxy,
// neither of which a unit test needs. Keeping a separate, minimal config means
// the tests do not depend on how the dev server is set up.
export default defineConfig({
  // Pinned to this directory, so the include globs below mean the same thing
  // whether vitest is invoked from here or from the repo root.
  root: __dirname,
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
