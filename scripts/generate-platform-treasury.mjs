#!/usr/bin/env node
/**
 * Generate a fresh EOA to use as PLATFORM_TREASURY_ADDRESS.
 *
 * Usage:
 *   node scripts/generate-platform-treasury.mjs
 *
 * The generated private key controls funds received as withdrawal platform fees.
 * Store it in a password manager / vault. DO NOT commit or paste into logs.
 *
 * Suggested follow-up (one-time):
 *   1. Copy the `address` into your Vercel + worker env as `PLATFORM_TREASURY_ADDRESS`.
 *   2. Store `privateKey` in 1Password / Vault as `PLATFORM_TREASURY_PRIVATE_KEY`.
 *      (Not used by the app today — held for off-ramping accumulated fees.)
 *   3. Redeploy web + worker so the new env var takes effect.
 */

import { ethers } from 'ethers'

const wallet = ethers.Wallet.createRandom()

const banner = '═'.repeat(74)
console.log('\n' + banner)
console.log('  nTZS Platform Treasury Wallet — generated')
console.log(banner)
console.log('')
console.log('  Address     :', wallet.address)
console.log('  Private key :', wallet.privateKey)
console.log('  Mnemonic    :', wallet.mnemonic?.phrase ?? '(no mnemonic)')
console.log('')
console.log('  Next steps:')
console.log('  1. Vercel env:   PLATFORM_TREASURY_ADDRESS =', wallet.address)
console.log('  2. Worker env:   PLATFORM_TREASURY_ADDRESS =', wallet.address)
console.log('  3. Store the private key + mnemonic in your password manager.')
console.log('  4. Redeploy web + worker.')
console.log('')
console.log('  SECURITY: this is the only time the private key is printed.')
console.log('  If you lose it, funds sent to this address are unrecoverable.')
console.log(banner + '\n')
