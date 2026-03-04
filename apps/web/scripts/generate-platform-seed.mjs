/**
 * Run once to generate an encrypted platform HD seed for direct end-users.
 * Requires WAAS_ENCRYPTION_KEY to already be set in .env.local
 *
 * Usage: node apps/web/scripts/generate-platform-seed.mjs
 */

import { ethers } from 'ethers'
import { createCipheriv, randomBytes } from 'crypto'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local manually
const envPath = join(__dirname, '../../../.env.local')
const envContent = readFileSync(envPath, 'utf8')
const envLines = envContent.split('\n')
for (const line of envLines) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) {
    const key = match[1].trim()
    const val = match[2].trim().replace(/^["']|["']$/g, '')
    process.env[key] = val
  }
}

const key = process.env.WAAS_ENCRYPTION_KEY
if (!key) {
  console.error('ERROR: WAAS_ENCRYPTION_KEY not set in .env.local')
  process.exit(1)
}

const keyBuf = Buffer.from(key, 'hex')
if (keyBuf.length !== 32) {
  console.error('ERROR: WAAS_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
  process.exit(1)
}

function encryptSeed(plaintext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBuf, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

const wallet = ethers.Wallet.createRandom()
const mnemonic = wallet.mnemonic.phrase
const encrypted = encryptSeed(mnemonic)

console.log('\n=== Platform HD Seed Generated ===\n')
console.log('Add this line to your .env.local:\n')
console.log(`PLATFORM_HD_SEED="${encrypted}"`)
console.log('\n--- KEEP THIS SECRET — store in a secure offline backup ---')
console.log('Mnemonic phrase:', mnemonic)
console.log('First wallet address (index 0):', wallet.address)
console.log('\n===================================\n')
