import type { NextConfig } from 'next'
import path from 'path'
import { config as loadEnv } from 'dotenv'

// Load root .env when running from apps/fx in a monorepo
// (Next.js only auto-loads .env from the app's own directory)
if (process.env.NODE_ENV !== 'production') {
  loadEnv({ path: path.resolve(process.cwd(), '../../.env'), override: false })
}

const nextConfig: NextConfig = {
  transpilePackages: ['@ntzs/db'],
}

export default nextConfig
