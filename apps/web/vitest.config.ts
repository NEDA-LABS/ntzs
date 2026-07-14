import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Mirror the tsconfig path aliases so unit tests can import modules that use
// '@/…' (e.g. lib/sandbox/limits.ts) without pulling in a bundler.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
