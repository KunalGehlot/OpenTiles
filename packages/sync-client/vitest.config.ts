import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The in-process sync service uses node:sqlite, which still warns on Node 22.
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
