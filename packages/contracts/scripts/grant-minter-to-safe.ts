/**
 * Grant MINTER_ROLE to the Safe multisig contract address.
 *
 * Run with:
 *   SAFE_MULTISIG_ADDRESS=0x<your-safe-address> npx ts-node scripts/grant-minter-to-safe.ts
 *
 * Requires env vars:
 *   NTZS_CONTRACT_ADDRESS_BASE  — nTZS token contract
 *   SAFE_ADMIN_PRIVATE_KEY      — private key of 0xB2b8...C503 (has DEFAULT_ADMIN_ROLE)
 *   BASE_RPC_URL
 */

import path from 'path'
import dotenv from 'dotenv'
import { ethers } from 'ethers'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), override: true })

const ABI = [
  'function grantRole(bytes32 role, address account)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function MINTER_ROLE() view returns (bytes32)',
] as const

async function main() {
  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  const adminPrivateKey  = process.env.SAFE_ADMIN_PRIVATE_KEY
  const rpcUrl           = process.env.BASE_RPC_URL
  const safeAddress      = process.env.SAFE_MULTISIG_ADDRESS

  if (!contractAddress) throw new Error('Missing: NTZS_CONTRACT_ADDRESS_BASE')
  if (!adminPrivateKey)  throw new Error('Missing: SAFE_ADMIN_PRIVATE_KEY')
  if (!rpcUrl)           throw new Error('Missing: BASE_RPC_URL')
  if (!safeAddress)      throw new Error('Missing: SAFE_MULTISIG_ADDRESS (pass as env var)')

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const admin    = new ethers.Wallet(adminPrivateKey, provider)
  const contract = new ethers.Contract(contractAddress, ABI, admin)

  console.log('Admin (DEFAULT_ADMIN_ROLE):', await admin.getAddress())
  console.log('Safe multisig address:    ', safeAddress)
  console.log('nTZS contract:            ', contractAddress)

  const MINTER_ROLE: string = await contract.MINTER_ROLE()
  const alreadyHas = await contract.hasRole(MINTER_ROLE, safeAddress)

  if (alreadyHas) {
    console.log('Safe already has MINTER_ROLE — nothing to do.')
    return
  }

  console.log('Granting MINTER_ROLE to Safe multisig...')
  const tx = await contract.grantRole(MINTER_ROLE, safeAddress)
  console.log('Tx submitted:', tx.hash)
  await tx.wait(1)
  console.log('Done. Safe multisig now has MINTER_ROLE.')
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
