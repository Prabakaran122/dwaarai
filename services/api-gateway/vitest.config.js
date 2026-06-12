import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // Each suite boots the Express app + mocks; running all files fully parallel
    // under load intermittently drops a file during collection. Cap the pool so
    // the suite collects and passes deterministically.
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
  },
});
