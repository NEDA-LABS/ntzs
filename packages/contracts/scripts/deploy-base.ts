import path from 'path'
import dotenv from 'dotenv'
import hre from 'hardhat'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), override: true })

async function main() {
  const safeAdmin = process.env.NTZS_SAFE_ADMIN

  if (!safeAdmin) {
    throw new Error('Missing env var: NTZS_SAFE_ADMIN')
  }

  const { ethers } = hre
  const upgrades = (hre as any).upgrades

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()
  console.log('Deployer:', deployerAddress)

  const balance = await ethers.provider.getBalance(deployerAddress)
  console.log('Deployer balance:', ethers.formatEther(balance), 'ETH')

  if (balance === 0n) {
    throw new Error('Deployer wallet has 0 ETH on Base mainnet. Fund it first.')
  }

  const NTZSV2 = await ethers.getContractFactory('NTZSV2')

  console.log('Deploying NTZSV2 proxy to Base mainnet...')
  const proxy: any = await upgrades.deployProxy(NTZSV2, [safeAdmin], {
    kind: 'uups',
    initializer: 'initialize',
    unsafeAllow: ['constructor'],
  })
  await proxy.waitForDeployment()

  const proxyAddress = await proxy.getAddress()
  console.log('NTZSV2 (proxy) deployed to:', proxyAddress)

  console.log('\nDone. Set this in your .env.local:')
  console.log('NTZS_CONTRACT_ADDRESS_BASE=' + proxyAddress)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
