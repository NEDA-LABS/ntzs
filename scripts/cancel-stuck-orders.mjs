/**
 * Recovers nTZS stuck in expired IntentGateway orders.
 * Queries OrderPlaced events for our swap wallet, filters expired ones,
 * and calls cancelOrder to release the escrowed tokens back to the user.
 */
import { ethers } from 'ethers'
import { createRequire } from 'module'
import { config } from 'dotenv'
config({ path: '.env' })

const require = createRequire(import.meta.url)

const GATEWAY = '0x2d61624A17f361020679FaA16fbB566C344AaF4B'
const SWAP_WALLET = '0x404E1F88B498936a75D40aD3DF6F3D4dA4BAE6A8'
// beneficiary in orders is left-padded wallet address
const BENEFICIARY = '0x000000000000000000000000404e1f88b498936a75d40ad3df6f3d4da4bae6a8'

const GATEWAY_ABI = [
  {
    type: 'event',
    name: 'OrderPlaced',
    inputs: [
      { name: 'user', type: 'bytes32' },
      { name: 'source', type: 'bytes' },
      { name: 'destination', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'fees', type: 'uint256' },
      { name: 'session', type: 'address' },
      { name: 'beneficiary', type: 'bytes32' },
      { name: 'predispatch', type: 'tuple[]', components: [
        { name: 'token', type: 'bytes32' },
        { name: 'amount', type: 'uint256' },
      ]},
      { name: 'inputs', type: 'tuple[]', components: [
        { name: 'token', type: 'bytes32' },
        { name: 'amount', type: 'uint256' },
      ]},
      { name: 'outputs', type: 'tuple[]', components: [
        { name: 'token', type: 'bytes32' },
        { name: 'amount', type: 'uint256' },
      ]},
    ],
  },
  {
    type: 'function',
    name: 'cancelOrder',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'user', type: 'bytes32' },
          { name: 'source', type: 'bytes' },
          { name: 'destination', type: 'bytes' },
          { name: 'deadline', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'fees', type: 'uint256' },
          { name: 'session', type: 'address' },
          {
            name: 'predispatch', type: 'tuple', components: [
              { name: 'assets', type: 'tuple[]', components: [
                { name: 'token', type: 'bytes32' },
                { name: 'amount', type: 'uint256' },
              ]},
              { name: 'call', type: 'bytes' },
            ],
          },
          { name: 'inputs', type: 'tuple[]', components: [
            { name: 'token', type: 'bytes32' },
            { name: 'amount', type: 'uint256' },
          ]},
          {
            name: 'output', type: 'tuple', components: [
              { name: 'beneficiary', type: 'bytes32' },
              { name: 'assets', type: 'tuple[]', components: [
                { name: 'token', type: 'bytes32' },
                { name: 'amount', type: 'uint256' },
              ]},
              { name: 'call', type: 'bytes' },
            ],
          },
        ],
      },
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'relayerFee', type: 'uint256' },
          { name: 'height', type: 'uint256' },
        ],
      },
    ],
  },
]

const NTZS_ABI = ['function balanceOf(address) view returns (uint256)']
const NTZS = '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688'

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL)
  const minterKey = process.env.MINTER_PRIVATE_KEY.startsWith('0x')
    ? process.env.MINTER_PRIVATE_KEY
    : '0x' + process.env.MINTER_PRIVATE_KEY
  const signer = new ethers.Wallet(minterKey, provider)

  const gateway = new ethers.Contract(GATEWAY, GATEWAY_ABI, provider)
  const ntzs = new ethers.Contract(NTZS, NTZS_ABI, provider)

  const currentBlock = await provider.getBlockNumber()
  const fromBlock = currentBlock - 200_000 // ~5 days of Base blocks

  console.log(`Scanning blocks ${fromBlock}–${currentBlock} for OrderPlaced events...`)

  const filter = gateway.filters.OrderPlaced()
  const events = await gateway.queryFilter(filter, fromBlock, currentBlock)
  console.log(`Found ${events.length} OrderPlaced events total`)

  const nowSec = BigInt(Math.floor(Date.now() / 1000))

  // Filter to orders where beneficiary matches our wallet
  const ours = events.filter(e => {
    const b = e.args.beneficiary.toLowerCase()
    return b === BENEFICIARY.toLowerCase()
  })

  console.log(`Orders from our wallet: ${ours.length}`)

  if (ours.length === 0) {
    console.log('Nothing to cancel.')
    return
  }

  const balBefore = await ntzs.balanceOf(SWAP_WALLET)
  console.log(`Wallet nTZS before: ${ethers.formatUnits(balBefore, 18)}`)

  const gatewaySigner = gateway.connect(signer)

  for (const ev of ours) {
    const a = ev.args
    const deadline = a.deadline

    if (deadline > nowSec) {
      console.log(`Order nonce ${a.nonce} not yet expired (deadline ${new Date(Number(deadline) * 1000).toISOString()}) — skipping`)
      continue
    }

    console.log(`\nCancelling order nonce=${a.nonce}, deadline=${new Date(Number(deadline) * 1000).toISOString()}`)
    console.log(`  session: ${a.session}`)

    // Deep-copy event args — ethers v6 returns frozen Result objects that can't be mutated
    const copyTokens = (arr) => arr.map(t => ({ token: t.token, amount: t.amount }))

    const order = {
      user: a.user,
      source: a.source,
      destination: a.destination,
      deadline: a.deadline,
      nonce: a.nonce,
      fees: a.fees,
      session: a.session,
      predispatch: { assets: copyTokens(a.predispatch), call: '0x' },
      inputs: copyTokens(a.inputs),
      output: { beneficiary: a.beneficiary, assets: copyTokens(a.outputs), call: '0x' },
    }

    try {
      const tx = await gatewaySigner.cancelOrder(order, { relayerFee: 0n, height: 0n })
      console.log(`  tx submitted: ${tx.hash}`)
      const receipt = await tx.wait()
      console.log(`  ✓ confirmed in block ${receipt.blockNumber}`)
    } catch (err) {
      console.log(`  ✗ failed: ${err.shortMessage || err.message}`)
    }
  }

  const balAfter = await ntzs.balanceOf(SWAP_WALLET)
  console.log(`\nWallet nTZS after: ${ethers.formatUnits(balAfter, 18)}`)
  const recovered = balAfter - balBefore
  console.log(`Recovered: ${ethers.formatUnits(recovered, 18)} nTZS`)
}

main().catch(console.error)
