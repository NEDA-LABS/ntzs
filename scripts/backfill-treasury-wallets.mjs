/**
 * Backfill treasury wallet addresses for existing partners.
 *
 * Finds all partners that have an encrypted_hd_seed but no treasury_wallet_address,
 * derives the treasury address (m/44'/8453'/1'/0/0), and stores it.
 *
 * Safe to run multiple times — only updates partners where treasury_wallet_address IS NULL.
 */
import 'dotenv/config'
import pg from 'pg'
import { createDecipheriv } from 'crypto'
import { ethers } from 'ethers'

const { Client } = pg

function getEncryptionKey() {
  const key = process.env.WAAS_ENCRYPTION_KEY
  if (!key) throw new Error('WAAS_ENCRYPTION_KEY is not set')
  const buf = Buffer.from(key, 'hex')
  if (buf.length !== 32) throw new Error('WAAS_ENCRYPTION_KEY must be 64 hex chars')
  return buf
}

function decryptSeed(encrypted) {
  const key = getEncryptionKey()
  const [ivHex, authTagHex, ciphertext] = encrypted.split(':')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function deriveTreasuryAddress(encryptedSeed) {
  const mnemonic = decryptSeed(encryptedSeed)
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/8453'/1'/0")
  return hdNode.deriveChild(0).address
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  const { rows } = await client.query(`
    SELECT id, name, encrypted_hd_seed
    FROM partners
    WHERE encrypted_hd_seed IS NOT NULL
      AND treasury_wallet_address IS NULL
  `)

  if (rows.length === 0) {
    console.log('No partners need backfilling.')
    await client.end()
    return
  }

  console.log(`Found ${rows.length} partner(s) to backfill...`)

  for (const row of rows) {
    try {
      const address = deriveTreasuryAddress(row.encrypted_hd_seed)
      await client.query(
        `UPDATE partners SET treasury_wallet_address = $1 WHERE id = $2`,
        [address, row.id]
      )
      console.log(`  ✓ ${row.name} (${row.id.slice(0, 8)}) → ${address}`)
    } catch (err) {
      console.error(`  ✗ ${row.name} (${row.id.slice(0, 8)}) — ${err.message}`)
    }
  }

  console.log('Done.')
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
