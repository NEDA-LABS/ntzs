import type { NextConfig } from 'next'

import dotenv from 'dotenv'
import path from 'path'

declare const __dirname: string

// In a monorepo, we keep shared env vars (like NEON_AUTH_BASE_URL) at the repo root.
// Next.js middleware runs on the server and expects these env vars to exist at runtime.
// Load them here so they're available during dev/build.
const webRoot = __dirname
const repoRoot = path.resolve(webRoot, '../..')

dotenv.config({ path: path.join(repoRoot, '.env') })
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true })
dotenv.config({ path: path.join(webRoot, '.env.local'), override: true })

// Compatibility: some setups may use NEON_AUTH_URL. The SDK expects NEON_AUTH_BASE_URL.
if (!process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_URL) {
  process.env.NEON_AUTH_BASE_URL = process.env.NEON_AUTH_URL
}

const nextConfig: NextConfig = {
  turbopack: {
    root: repoRoot,
  },
  env: {
    NEON_AUTH_BASE_URL: process.env.NEON_AUTH_BASE_URL,
  },
}

export default nextConfig
