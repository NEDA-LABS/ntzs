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

  const burnerRole = await token.BURNER_ROLE()

  const paused = await token.paused()
  const hasBurnerRole = await token.hasRole(burnerRole, signerAddr)
  const balance = await token.balanceOf(user)
  const totalSupply = await token.totalSupply()

  console.log('token', tokenAddr)
  console.log('signer', signerAddr)
  console.log('paused', paused)
  console.log('signer_has_BURNER_ROLE', hasBurnerRole)
  console.log('user', user)
  console.log('user_balance', balance.toString())
  console.log('totalSupply', totalSupply.toString())
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
