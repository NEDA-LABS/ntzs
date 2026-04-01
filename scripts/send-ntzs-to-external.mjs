/**
 * One-off: send nTZS from a WaaS user wallet to an external Base address.
 *
 * Usage:
 *   node scripts/send-ntzs-to-external.mjs \
 *     --email v.muhagachi@gmail.com \
 *     --partner mxsafiri \
 *     --to 0x3FCB8C79f32bBfFBaAbc14C69a755562FacEBb84 \
 *     --amount 2000
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'
import pg from 'pg'
import { ethers } from 'ethers'
import crypto from 'crypto'
import readline from 'readline'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true })

const { Client } = pg

// ─── CLI args ──────────────────────────────────────────────────────────────────
function arg(name) {
  const idx = process.argv.indexOf(`--${name}`)
  return idx !== -1 ? process.argv[idx + 1] : null
}

const EMAIL   = arg('email')   ?? 'v.muhagachi@gmail.com'
const PARTNER = arg('partner') ?? 'mxsafiri'
const TO      = arg('to')      ?? '0x3FCB8C79f32bBfFBaAbc14C69a755562FacEBb84'
const AMOUNT  = parseFloat(arg('amount') ?? '2000')

// ─── Crypto helpers ────────────────────────────────────────────────────────────
function decryptSeed(encryptedSeed) {
  const key = Buffer.from(process.env.WAAS_ENCRYPTION_KEY, 'hex')
  const [ivHex, authTagHex, ciphertext] = encryptedSeed.split(':')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function deriveWallet(encryptedSeed, walletIndex) {
  const mnemonic = decryptSeed(encryptedSeed)
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/8453'/0'/0")
  return hdNode.deriveChild(walletIndex)
}

// ─── Prompt helper ─────────────────────────────────────────────────────────────
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()) }))
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const rpcUrl          = process.env.BASE_RPC_URL
  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE ?? '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'
  const relayerKey      = process.env.RELAYER_PRIVATE_KEY ?? process.env.MINTER_PRIVATE_KEY

  if (!rpcUrl)    throw new Error('BASE_RPC_URL is not set')
  if (!process.env.WAAS_ENCRYPTION_KEY) throw new Error('WAAS_ENCRYPTION_KEY is not set')
  if (!ethers.isAddress(TO)) throw new Error(`Invalid destination address: ${TO}`)

  console.log('--- Send nTZS to external address ---')
  console.log(`From user : ${EMAIL}  (partner: ${PARTNER})`)
  console.log(`To        : ${TO}`)
  console.log(`Amount    : ${AMOUNT} nTZS`)
  console.log(`Contract  : ${contractAddress}`)
  console.log('')

  // ── Query DB for user, wallet index, partner seed ──────────────────────────
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  const { rows } = await client.query(`
    SELECT
      u.id          AS user_id,
      u.email,
      w.address     AS wallet_address,
      pu.wallet_index,
      p.name        AS partner_name,
      p.encrypted_hd_seed
    FROM users u
    JOIN partner_users pu ON pu.user_id = u.id
    JOIN partners p ON p.id = pu.partner_id
    JOIN wallets w ON w.user_id = u.id AND w.chain = 'base'
    WHERE u.email = $1
      AND LOWER(p.name) = LOWER($2)
      AND pu.wallet_index IS NOT NULL
      AND w.address NOT LIKE '0x_pending_%'
    LIMIT 1
  `, [EMAIL, PARTNER])

  await client.end()

  if (rows.length === 0) {
    throw new Error(`No HD wallet found for ${EMAIL} under partner "${PARTNER}"`)
  }

  const row = rows[0]
  console.log(`Wallet address : ${row.wallet_address}`)
  console.log(`Wallet index   : ${row.wallet_index}`)
  console.log('')

  // ── Connect to chain ───────────────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const wallet   = deriveWallet(row.encrypted_hd_seed, row.wallet_index).connect(provider)

  // Sanity-check: derived address must match DB record
  if (wallet.address.toLowerCase() !== row.wallet_address.toLowerCase()) {
    throw new Error(
      `Derived address ${wallet.address} does not match DB record ${row.wallet_address}.\n` +
      'Aborting to prevent signing from the wrong wallet.'
    )
  }

  // ── Check nTZS balance ─────────────────────────────────────────────────────
  const erc20 = new ethers.Contract(
    contractAddress,
    [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
    ],
    provider
  )

  const balanceWei    = await erc20.balanceOf(wallet.address)
  const balanceTzs    = Number(ethers.formatUnits(balanceWei, 18))
  const amountWei     = ethers.parseUnits(AMOUNT.toString(), 18)

  console.log(`nTZS balance   : ${balanceTzs} TZS`)

  if (balanceWei < amountWei) {
    throw new Error(`Insufficient nTZS balance: has ${balanceTzs}, needs ${AMOUNT}`)
  }

  // ── Check / top-up ETH gas ─────────────────────────────────────────────────
  const MIN_GAS_WEI = ethers.parseEther('0.0001')
  const ethBalance  = await provider.getBalance(wallet.address)
  console.log(`ETH balance    : ${ethers.formatEther(ethBalance)} ETH`)

  if (ethBalance < MIN_GAS_WEI) {
    if (!relayerKey) {
      throw new Error('Wallet has no ETH for gas and RELAYER_PRIVATE_KEY / MINTER_PRIVATE_KEY is not set')
    }
    console.log('Low ETH — topping up gas from relayer...')
    const relayer = new ethers.Wallet(relayerKey, provider)
    const gasTx   = await relayer.sendTransaction({
      to: wallet.address,
      value: ethers.parseEther('0.0001'),
    })
    await gasTx.wait(1)
    console.log(`Gas top-up tx  : ${gasTx.hash}`)
  }

  // ── Confirm before sending ─────────────────────────────────────────────────
  const answer = await prompt(`\nType "yes" to send ${AMOUNT} nTZS from ${wallet.address} to ${TO}: `)
  if (answer.toLowerCase() !== 'yes') {
    console.log('Aborted.')
    process.exit(0)
  }

  // ── Send transfer ──────────────────────────────────────────────────────────
  console.log('\nSubmitting transaction...')
  const erc20Signer = erc20.connect(wallet)
  const tx          = await erc20Signer.transfer(TO, amountWei)
  console.log(`TX submitted   : ${tx.hash}`)
  process.stdout.write('Waiting for confirmation...')
  const receipt = await tx.wait(1)
  console.log(' confirmed.')
  console.log('')
  console.log(`Transaction    : ${receipt.hash}`)
  console.log(`Block          : ${receipt.blockNumber}`)
  console.log(`Basescan       : https://basescan.org/tx/${receipt.hash}`)
  console.log('')
  console.log(`Done: ${AMOUNT} nTZS sent from ${wallet.address} to ${TO}`)
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
