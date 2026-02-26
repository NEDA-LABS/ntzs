/**
 * HD Wallet Service for WaaS Partners
 *
 * Each partner gets an isolated HD master seed (BIP-39 mnemonic) that is
 * AES-256-GCM encrypted at rest. User wallets are derived deterministically
 * using BIP-44: m/44'/8453'/0'/0/{walletIndex}
 *
 * Chain ID 8453 = Base mainnet (used as the coin-type for derivation).
 *
 * The platform holds the encryption key (WAAS_ENCRYPTION_KEY env var).
 * Individual user private keys are derived on-demand and never persisted.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { ethers } from 'ethers'

const DERIVATION_BASE = "m/44'/8453'/0'/0"

// ─── Encryption helpers (AES-256-GCM) ─────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const key = process.env.WAAS_ENCRYPTION_KEY
  if (!key) throw new Error('WAAS_ENCRYPTION_KEY is not set')
  // Key must be 32 bytes (64 hex chars) for AES-256
  const buf = Buffer.from(key, 'hex')
  if (buf.length !== 32) {
    throw new Error('WAAS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
  }
  return buf
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns: iv:authTag:ciphertext (all hex-encoded)
 */
export function encryptSeed(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(12) // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Expects format: iv:authTag:ciphertext (all hex-encoded)
 */
export function decryptSeed(encrypted: string): string {
  const key = getEncryptionKey()
  const [ivHex, authTagHex, ciphertext] = encrypted.split(':')
  if (!ivHex || !authTagHex || !ciphertext) {
    throw new Error('Invalid encrypted seed format')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

// ─── HD Wallet operations ──────────────────────────────────────────────────────

/**
 * Generate a new BIP-39 mnemonic and return it encrypted.
 * Called once when a partner is onboarded.
 */
export function generatePartnerSeed(): { encryptedSeed: string } {
  const wallet = ethers.Wallet.createRandom()
  if (!wallet.mnemonic) throw new Error('Failed to generate mnemonic')
  const mnemonic = wallet.mnemonic.phrase
  return { encryptedSeed: encryptSeed(mnemonic) }
}

/**
 * Derive a user's wallet address from the partner's encrypted HD seed
 * and the user's wallet index. Does NOT expose the private key.
 */
export function deriveAddress(encryptedSeed: string, walletIndex: number): string {
  const mnemonic = decryptSeed(encryptedSeed)
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, DERIVATION_BASE)
  const child = hdNode.deriveChild(walletIndex)
  return child.address
}

/**
 * Derive the full wallet (with private key) for signing transactions.
 * The caller MUST discard this object after use — never persist the key.
 */
export function deriveWallet(encryptedSeed: string, walletIndex: number): ethers.HDNodeWallet {
  const mnemonic = decryptSeed(encryptedSeed)
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, DERIVATION_BASE)
  return hdNode.deriveChild(walletIndex)
}

/**
 * Fund a user wallet with a small amount of ETH for gas from the platform relayer.
 * Called once at wallet creation. Silently skips if RELAYER_PRIVATE_KEY is not set.
 * On Base mainnet 0.0005 ETH covers ~500 ERC-20 transfers at current gas prices.
 */
export async function fundWalletWithGas(params: {
  toAddress: string
  rpcUrl: string
  amountEth?: string
}): Promise<{ txHash: string } | null> {
  const relayerKey = process.env.RELAYER_PRIVATE_KEY
  if (!relayerKey) {
    console.warn('[hd-wallets] RELAYER_PRIVATE_KEY not set — skipping gas prefund')
    return null
  }

  const { toAddress, rpcUrl, amountEth = '0.0005' } = params
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const relayer = new ethers.Wallet(relayerKey, provider)

  // Check relayer balance before attempting
  const relayerBalance = await provider.getBalance(relayer.address)
  const amountWei = ethers.parseEther(amountEth)
  if (relayerBalance < amountWei) {
    console.error(
      `[hd-wallets] Relayer ${relayer.address} has insufficient ETH: ${ethers.formatEther(relayerBalance)} ETH`
    )
    return null
  }

  const tx = await relayer.sendTransaction({ to: toAddress, value: amountWei })
  const receipt = await tx.wait()
  if (!receipt) throw new Error('Gas prefund receipt is null')

  console.log(`[hd-wallets] Prefunded ${toAddress} with ${amountEth} ETH, tx: ${receipt.hash}`)
  return { txHash: receipt.hash }
}

/**
 * Sign and send an ERC-20 transfer on behalf of a WaaS user.
 * Derives the user's private key on-demand, signs, sends, and discards.
 */
export async function signAndSendTransfer(params: {
  encryptedSeed: string
  walletIndex: number
  contractAddress: string
  toAddress: string
  amountWei: bigint
  rpcUrl: string
}): Promise<{ txHash: string }> {
  const { encryptedSeed, walletIndex, contractAddress, toAddress, amountWei, rpcUrl } = params

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const wallet = deriveWallet(encryptedSeed, walletIndex).connect(provider)

  const iface = new ethers.Interface([
    'function transfer(address to, uint256 amount) returns (bool)',
  ])

  const tx = await wallet.sendTransaction({
    to: contractAddress,
    data: iface.encodeFunctionData('transfer', [toAddress, amountWei]),
  })

  const receipt = await tx.wait()
  if (!receipt) throw new Error('Transaction receipt is null')

  return { txHash: receipt.hash }
}
