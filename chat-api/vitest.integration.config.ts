import { defineConfig } from 'vitest/config';

// Runs against a live API with a real MongoDB (started by docker compose, see .github/workflows/ci.yml).
export default defineConfig({
  test: { include: ['tests-integration/**/*.test.ts'], testTimeout: 20_000, hookTimeout: 20_000, fileParallelism: false }
});
