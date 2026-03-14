import path from 'path'
import dotenv from 'dotenv'
import hre from 'hardhat'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), override: true })

const ABI = [
  'function grantRole(bytes32 role, address account)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function BURNER_ROLE() view returns (bytes32)',
] as const

async function main() {
  const contractAddress = process.env.NTZS_CONTRACT_ADDRESS_BASE
  const minterPrivateKey = process.env.MINTER_PRIVATE_KEY
  const safeAdminPrivateKey = process.env.SAFE_ADMIN_PRIVATE_KEY

  if (!contractAddress) throw new Error('Missing env var: NTZS_CONTRACT_ADDRESS_BASE')
  if (!minterPrivateKey) throw new Error('Missing env var: MINTER_PRIVATE_KEY')
  if (!safeAdminPrivateKey) throw new Error('Missing env var: SAFE_ADMIN_PRIVATE_KEY (private key of NTZS_SAFE_ADMIN address)')

  const { ethers } = hre
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL)
  const adminSigner = new ethers.Wallet(safeAdminPrivateKey, provider)

  const minterWallet = new ethers.Wallet(minterPrivateKey)
  const minterAddress = minterWallet.address

  console.log('Admin (NTZS_SAFE_ADMIN):', await adminSigner.getAddress())
  console.log('Minter address:         ', minterAddress)
  console.log('Contract:               ', contractAddress)

  const contract = new ethers.Contract(contractAddress, ABI, adminSigner)

  const MINTER_ROLE: string = await contract.MINTER_ROLE()
  const BURNER_ROLE: string = await contract.BURNER_ROLE()

  const hasMinter = await contract.hasRole(MINTER_ROLE, minterAddress)
  const hasBurner = await contract.hasRole(BURNER_ROLE, minterAddress)

  if (hasMinter) {
    console.log('MINTER_ROLE already granted — skipping')
  } else {
    console.log('Granting MINTER_ROLE...')
    const tx = await contract.grantRole(MINTER_ROLE, minterAddress)
    await tx.wait(1)
    console.log('MINTER_ROLE granted, tx:', tx.hash)
  }

  if (hasBurner) {
    console.log('BURNER_ROLE already granted — skipping')
  } else {
    console.log('Granting BURNER_ROLE...')
    const tx = await contract.grantRole(BURNER_ROLE, minterAddress)
    await tx.wait(1)
    console.log('BURNER_ROLE granted, tx:', tx.hash)
  }

  console.log('\nDone. Minter wallet is ready on Base mainnet.')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
