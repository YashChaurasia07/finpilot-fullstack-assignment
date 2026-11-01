import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setupEnv.ts'], // sets the test environment before any source file reads process.env
    fileParallelism: false, // every file shares one test database, so run files one after another
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
