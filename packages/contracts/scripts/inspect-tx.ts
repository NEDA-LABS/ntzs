import hre from 'hardhat'

async function main() {
  const tokenAddr = process.env.NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA
  const user = process.env.BURN_TARGET_ADDRESS
  const txHash = process.env.TX_HASH

  if (!tokenAddr) throw new Error('Missing env var: NTZS_CONTRACT_ADDRESS_BASE_SEPOLIA')
  if (!user) throw new Error('Missing env var: BURN_TARGET_ADDRESS')
  if (!txHash) throw new Error('Missing env var: TX_HASH')

  const { ethers } = hre
  const provider = ethers.provider

  const receipt = await provider.getTransactionReceipt(txHash)
  if (!receipt) throw new Error('Receipt not found for tx: ' + txHash)

  console.log('tx', txHash)
  console.log('status', receipt.status)
  console.log('blockNumber', receipt.blockNumber)

  const NTZSV2 = await ethers.getContractFactory('NTZSV2')
  const token: any = NTZSV2.attach(tokenAddr)

  // Compare state at block-1 vs block
  const blockTagBefore = receipt.blockNumber - 1
  const blockTagAfter = receipt.blockNumber

  const balBefore = await token.balanceOf(user, { blockTag: blockTagBefore })
  const balAfter = await token.balanceOf(user, { blockTag: blockTagAfter })
  const supplyBefore = await token.totalSupply({ blockTag: blockTagBefore })
  const supplyAfter = await token.totalSupply({ blockTag: blockTagAfter })

  console.log('user_balance_before_block', blockTagBefore, balBefore.toString())
  console.log('user_balance_after_block', blockTagAfter, balAfter.toString())
  console.log('totalSupply_before_block', blockTagBefore, supplyBefore.toString())
  console.log('totalSupply_after_block', blockTagAfter, supplyAfter.toString())

  // Decode Transfer logs for this token
  const transferTopic = ethers.id('Transfer(address,address,uint256)')

  const logs = receipt.logs.filter((l) => l.address.toLowerCase() === tokenAddr.toLowerCase())
  console.log('token_logs_in_receipt', logs.length)

  for (const l of logs) {
    if (l.topics[0] !== transferTopic) continue
    const from = ethers.getAddress('0x' + l.topics[1].slice(26))
    const to = ethers.getAddress('0x' + l.topics[2].slice(26))
    const value = ethers.toBigInt(l.data)
    console.log('Transfer', { from, to, value: value.toString() })
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
