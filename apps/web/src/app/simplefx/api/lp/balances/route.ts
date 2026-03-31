import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts } from '@ntzs/db';
import { eq } from 'drizzle-orm';
import { JsonRpcProvider, Contract, formatUnits } from 'ethers';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const NTZS = '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688';
const USDC  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

async function getBalance(provider: JsonRpcProvider, token: string, wallet: string): Promise<string> {
  const contract = new Contract(token, ERC20_ABI, provider);
  const [raw, decimals]: [bigint, bigint] = await Promise.all([
    contract.balanceOf(wallet),
    contract.decimals(),
  ]);
  return formatUnits(raw, Number(decimals));
}

export async function GET() {
  try {
    const session = await getSessionFromCookies();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [lp] = await db
      .select({ walletAddress: lpAccounts.walletAddress })
      .from(lpAccounts)
      .where(eq(lpAccounts.id, session.lpId))
      .limit(1);

    if (!lp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const rpcUrl = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org';
    const provider = new JsonRpcProvider(rpcUrl);

    const [ntzs, usdc] = await Promise.all([
      getBalance(provider, NTZS, lp.walletAddress),
      getBalance(provider, USDC, lp.walletAddress),
    ]);

    return NextResponse.json({ ntzs, usdc });
  } catch (err) {
    console.error('[balances]', err);
    return NextResponse.json({ ntzs: '0', usdc: '0' });
  }
}
