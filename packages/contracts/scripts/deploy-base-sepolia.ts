import path from 'path'
import dotenv from 'dotenv'
import { ethers } from 'hardhat'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), override: true })

async function main() {
  const safeAdmin = process.env.NTZS_SAFE_ADMIN

  if (!safeAdmin) {
    throw new Error('Missing env var: NTZS_SAFE_ADMIN')
  }

  const [deployer] = await ethers.getSigners()
  console.log('Deployer:', await deployer.getAddress())

  const NTZS = await ethers.getContractFactory('NTZS')
  const token: any = await NTZS.deploy(safeAdmin)
  await token.waitForDeployment()

  const address = await token.getAddress()
  console.log('NTZS deployed to:', address)

  console.log('Granting MINTER_ROLE and BURNER_ROLE to deployer for testnet convenience...')
  const minterRole = await token.MINTER_ROLE()
  const burnerRole = await token.BURNER_ROLE()
  await (await token.grantRole(minterRole, await deployer.getAddress())).wait()
  await (await token.grantRole(burnerRole, await deployer.getAddress())).wait()

  console.log('Renouncing deployer DEFAULT_ADMIN_ROLE (Safe remains admin)...')
  await (await token.renounceDeployerAdmin()).wait()

  console.log('Done.')
  console.log('Set this in env: NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA=' + address)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
