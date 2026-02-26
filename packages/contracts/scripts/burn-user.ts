import hre from 'hardhat'

async function main() {
  const tokenAddr = process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA
  const user = process.env.BURN_TARGET_ADDRESS

  if (!tokenAddr) {
    throw new Error('Missing env var: NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA')
  }
  if (!user) {
    throw new Error('Missing env var: BURN_TARGET_ADDRESS')
  }

  const { ethers } = hre

  const [signer] = await ethers.getSigners()
  const signerAddr = await signer.getAddress()

  const NTZSV2 = await ethers.getContractFactory('NTZSV2')
  const token: any = NTZSV2.attach(tokenAddr)

  const amount = 1000n * 10n ** 18n

  const paused = await token.paused()
  if (paused) {
    throw new Error('Token is paused; burn is blocked by policy')
  }

  const burnerRole = await token.BURNER_ROLE()
  const hasBurnerRole = await token.hasRole(burnerRole, signerAddr)
  if (!hasBurnerRole) {
    throw new Error(`Signer ${signerAddr} does not have BURNER_ROLE`)
  }

  const balBefore = await token.balanceOf(user)
  const supplyBefore = await token.totalSupply()

  console.log('token', tokenAddr)
  console.log('signer', signerAddr)
  console.log('user', user)
  console.log('burn_amount_wei', amount.toString())
  console.log('user_balance_before', balBefore.toString())
  console.log('totalSupply_before', supplyBefore.toString())

  if (balBefore < amount) {
    throw new Error('User balance is less than burn amount')
  }

  const tx = await token.burn(user, amount)
  console.log('burn_tx', tx.hash)
  const receipt = await tx.wait()
  console.log('burn_receipt_status', receipt?.status)

  const balAfter = await token.balanceOf(user)
  const supplyAfter = await token.totalSupply()

  console.log('user_balance_after', balAfter.toString())
  console.log('totalSupply_after', supplyAfter.toString())
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
