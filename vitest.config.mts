import { defineConfig } from 'vitest/config';

// Unit tests cover the pure logic (signal processing, scoring). They run in
// plain Node with no camera, SDK session, or API key needed.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
