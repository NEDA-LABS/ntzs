#!/usr/bin/env tsx
import { ethers } from 'ethers'
import { BASE_RPC_URL, NTZS_CONTRACT_ADDRESS_BASE } from '../apps/web/src/lib/env'

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
]

async function checkNetwork(rpcUrl: string, networkName: string) {
  console.log(`\n🌐 Checking ${networkName}...`)
  console.log(`   RPC: ${rpcUrl}`)
  
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const network = await provider.getNetwork()
    console.log(`   Chain ID: ${network.chainId}`)
    console.log(`   Chain Name: ${network.name}`)

    const contractAddress = NTZS_CONTRACT_ADDRESS_BASE
    console.log(`   Contract: ${contractAddress}`)

    const token = new ethers.Contract(contractAddress, ERC20_ABI, provider)
    
    try {
      const name = await token.name()
      const symbol = await token.symbol()
      const decimals = await token.decimals()
      const totalSupplyWei: bigint = await token.totalSupply()
      const totalSupply = Number(totalSupplyWei / BigInt(10) ** BigInt(18))

      console.log(`   ✅ Contract found:`)
      console.log(`      Name: ${name}`)
      console.log(`      Symbol: ${symbol}`)
      console.log(`      Decimals: ${decimals}`)
      console.log(`      Total Supply: ${totalSupply.toLocaleString()} TZS`)
    } catch (err) {
      console.log(`   ❌ Contract not found or error: ${err instanceof Error ? err.message : String(err)}`)
    }
  } catch (err) {
    console.log(`   ❌ Network error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function main() {
  console.log('🔍 Verifying nTZS contract across networks...')
  console.log(`Contract Address: ${NTZS_CONTRACT_ADDRESS_BASE}\n`)

  // Check Base Mainnet (Alchemy)
  await checkNetwork(
    'https://base-mainnet.g.alchemy.com/v2/TTD2FFw8V5a368PK_9V5p',
    'Base Mainnet (Alchemy)'
  )

  // Check Base Mainnet (Public)
  await checkNetwork(
    'https://mainnet.base.org',
    'Base Mainnet (Public)'
  )

  // Check Base Sepolia Testnet
  await checkNetwork(
    'https://sepolia.base.org',
    'Base Sepolia Testnet'
  )

  console.log('\n')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
