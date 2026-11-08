import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Examples import the package by name, as users do. Without this, Vite would resolve the
    // name through the package's own `exports` to `dist`, which needs a build first.
    alias: [
      { find: /^@moeru\/cliff$/, replacement: fileURLToPath(new URL('src/index.ts', import.meta.url)) },
      { find: /^@moeru\/cliff\/(.+)$/, replacement: fileURLToPath(new URL('src/$1.ts', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
    },
  },
})
