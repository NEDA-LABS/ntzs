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

// Resolve the auth URL — SDK requires NEON_AUTH_BASE_URL; some envs only have NEON_AUTH_URL.
// Compute once so it's correctly set in both the main process and the compiled bundle.
const neonAuthBaseUrl = process.env.NEON_AUTH_BASE_URL ?? process.env.NEON_AUTH_URL ?? ''
process.env.NEON_AUTH_BASE_URL = neonAuthBaseUrl

const nextConfig: NextConfig = {
  turbopack: {
    root: repoRoot,
  },
  env: {
    NEON_AUTH_BASE_URL: neonAuthBaseUrl,
  },
  serverExternalPackages: [
    '@hyperbridge/sdk',
    '@substrate/connect',
    'smoldot',
  ],
}

export default nextConfig
