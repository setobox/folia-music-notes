import { defineConfig } from 'vitest/config';

// Keep the test suite scoped to the music notes module.
export default defineConfig({
    test: { include: ['test/**/*.test.ts'] },
});
