import { ethers } from 'ethers';

const RPC_URL = 'https://sepolia.base.org';
const CONTRACT = '0x6A9525A5C82F92E10741Fcdcb16DbE9111630077';

async function check() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  const token = new ethers.Contract(CONTRACT, [
    'function totalSupply() view returns (uint256)',
    'function decimals() view returns (uint8)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ], provider);
  
  const [totalSupply, decimals] = await Promise.all([
    token.totalSupply(),
    token.decimals(),
  ]);
  
  console.log('=== ON-CHAIN DATA ===');
  console.log(`Total Supply: ${ethers.formatUnits(totalSupply, decimals)} nTZS`);
  
  // Get all Transfer events (mints are from address(0)) - last 50000 blocks
  const currentBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 50000);
  const filter = token.filters.Transfer(ethers.ZeroAddress);
  const events = await token.queryFilter(filter, fromBlock, 'latest');
  
  console.log(`\n=== MINT EVENTS (Transfer from 0x0) ===`);
  console.log(`Total mint transactions: ${events.length}`);
  
  let mintTotal = 0n;
  for (const event of events) {
    const value = ethers.formatUnits(event.args[2], decimals);
    mintTotal += event.args[2];
    console.log(`Block ${event.blockNumber} | To: ${event.args[1].slice(0,10)}... | Amount: ${value} nTZS | TX: ${event.transactionHash.slice(0,20)}...`);
  }
  
  console.log(`\nTotal minted on-chain: ${ethers.formatUnits(mintTotal, decimals)} nTZS`);
}

check().catch(console.error);
