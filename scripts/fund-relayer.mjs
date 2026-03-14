/**
 * Transfers a USD-denominated amount of ETH from minter to relayer wallet.
 * Usage: node scripts/fund-relayer.mjs --usd 50
 */
import { ethers } from 'ethers'
import * as dotenv from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })
dotenv.config({ path: resolve(__dirname, '../.env.local'), override: true })

const usdArg = process.argv.find(a => a.startsWith('--usd'))
const USD_AMOUNT = usdArg
  ? Number(usdArg.split('=')[1] ?? process.argv[process.argv.indexOf('--usd') + 1])
  : 50

const RPC_URL = process.env.BASE_RPC_URL
const MINTER_KEY = process.env.MINTER_PRIVATE_KEY
const RELAYER_ADDRESS = '0x3920bb2b82005082484e4219752a449921167778'

if (!RPC_URL || !MINTER_KEY) {
  console.error('Missing BASE_RPC_URL or MINTER_PRIVATE_KEY')
  process.exit(1)
}

async function getEthUsdPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd')
    const data = await res.json()
    return data.ethereum.usd
  } catch {
    console.warn('Could not fetch live price, using fallback $2000')
    return 2000
  }
}

async function main() {
  const ethPrice = await getEthUsdPrice()
  const ethAmount = (USD_AMOUNT / ethPrice).toFixed(6)
  const amountWei = ethers.parseEther(ethAmount)

  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const minter = new ethers.Wallet(MINTER_KEY, provider)

  const minterBalance = await provider.getBalance(minter.address)
  const relayerBalance = await provider.getBalance(RELAYER_ADDRESS)

  console.log(`ETH price        : $${ethPrice}`)
  console.log(`Sending          : $${USD_AMOUNT} USD = ${ethAmount} ETH`)
  console.log(`From (minter)    : ${minter.address}  (${ethers.formatEther(minterBalance)} ETH)`)
  console.log(`To   (relayer)   : ${RELAYER_ADDRESS}  (${ethers.formatEther(relayerBalance)} ETH)`)

  if (minterBalance < amountWei) {
    console.error(`Minter has insufficient ETH. Has: ${ethers.formatEther(minterBalance)} ETH`)
    process.exit(1)
  }

  const tx = await minter.sendTransaction({ to: RELAYER_ADDRESS, value: amountWei })
  console.log(`TX submitted     : ${tx.hash}`)
  process.stdout.write('Waiting for confirmation...')
  await tx.wait(1)
  console.log(' confirmed.')

  const newRelayerBal = await provider.getBalance(RELAYER_ADDRESS)
  console.log(`Relayer balance  : ${ethers.formatEther(newRelayerBal)} ETH`)
  console.log('Done.')
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
