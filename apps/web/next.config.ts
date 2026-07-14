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

// Resolve the auth URL for local dev — SDK requires NEON_AUTH_BASE_URL; .env only has NEON_AUTH_URL.
// This assignment is for the local dev main process only. On Vercel, NEON_AUTH_BASE_URL must be
// set explicitly in the project environment variables — do NOT add it to `env:` config below,
// as that would cause Turbopack to inline an empty string at build time, breaking the middleware.
if (!process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_URL) {
  process.env.NEON_AUTH_BASE_URL = process.env.NEON_AUTH_URL
}

const nextConfig: NextConfig = {
  turbopack: {
    root: repoRoot,
  },
  // Source-shipped workspace packages that client components import
  // (@ntzs/psp/fees powers the withdraw form's live fee quote).
  transpilePackages: ['@ntzs/psp'],
  serverExternalPackages: [
    '@hyperbridge/sdk',
    '@substrate/connect',
    'smoldot',
  ],
}

export default nextConfig
