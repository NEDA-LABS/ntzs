import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/fx/auth';
import { db } from '@/lib/fx/db';
import { lpAccounts, lpFxPairs, lpPoolPositions, lpWalletTransactions } from '@ntzs/db';
import { eq, sql, and } from 'drizzle-orm';
import { deriveWallet } from '@/lib/fx/lp-wallet';
import { JsonRpcProvider, Wallet, Contract, formatUnits, parseUnits } from 'ethers';
import { getChainConfig, type ChainId } from '@/lib/fx/chainConfig';
import { withLpOpLock, LP_LOCK_BUSY } from '@/lib/fx/lp-lock';

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const isActive: boolean = body.isActive;
  const chain: ChainId = body.chain ?? 'base';

  let chainCfg: ReturnType<typeof getChainConfig>;
  try {
    chainCfg = getChainConfig(chain);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }

  const [lp] = await db
    .select()
    .from(lpAccounts)
    .where(eq(lpAccounts.id, session.lpId))
    .limit(1);

  if (!lp) return NextResponse.json({ error: 'LP account not found' }, { status: 404 });

  const provider = new JsonRpcProvider(chainCfg.rpcUrl);

  // Serialize activate/deactivate for this LP so a double-click can't run two
  // concurrently — for deactivate, two requests could otherwise both read the same
  // positions and both pay them out from the shared solver. Second call gets 409.
  const result = await withLpOpLock(lp.id, () =>
    handleActivation({ isActive, chain, chainCfg, lp, provider }),
  );
  if (result === LP_LOCK_BUSY) {
    return NextResponse.json(
      { error: 'An activate/deactivate is already in progress for this account. Please wait a moment and try again.' },
      { status: 409 },
    );
  }
  return result;
}

async function handleActivation({
  isActive,
  chain,
  chainCfg,
  lp,
  provider,
}: {
  isActive: boolean;
  chain: ChainId;
  chainCfg: ReturnType<typeof getChainConfig>;
  lp: typeof lpAccounts.$inferSelect;
  provider: JsonRpcProvider;
}): Promise<NextResponse> {
  if (isActive) {
    // ── ACTIVATE: sweep LP wallet tokens into the solver pool ───────────────
    // Only look at pairs for the requested chain
    const pairs = await db
      .select()
      .from(lpFxPairs)
      .where(and(eq(lpFxPairs.isActive, true), eq(lpFxPairs.chain, chain)));

    if (pairs.length === 0) {
      return NextResponse.json({ error: `No active trading pairs configured for ${chain}` }, { status: 400 });
    }

    // Collect unique token addresses for this chain
    const tokens = new Map<string, { symbol: string; decimals: number }>();
    for (const pair of pairs) {
      tokens.set(pair.token1Address.toLowerCase(), { symbol: pair.token1Symbol, decimals: pair.token1Decimals });
      tokens.set(pair.token2Address.toLowerCase(), { symbol: pair.token2Symbol, decimals: pair.token2Decimals });
    }

    const { privateKey } = deriveWallet(lp.walletIndex);
    const lpSigner = new Wallet(privateKey, provider);

    // Pre-fund LP wallet with gas if needed
    const lpGasBalance: bigint = await provider.getBalance(lp.walletAddress);
    if (lpGasBalance < chainCfg.minGas) {
      const relayerKey = chainCfg.relayerKey;
      if (!relayerKey) return NextResponse.json({ error: `Relayer key not configured for ${chain} — cannot fund gas` }, { status: 503 });
      const relayer = new Wallet(relayerKey, provider);
      const gasTx = await relayer.sendTransaction({ to: lp.walletAddress, value: chainCfg.minGas });
      await gasTx.wait(1);
    }

    const swept: Array<{ tokenAddress: string; symbol: string; amount: string }> = [];

    for (const [tokenAddress, { symbol, decimals }] of tokens) {
      const contract = new Contract(tokenAddress, ERC20_ABI, lpSigner);
      const balance: bigint = await contract.balanceOf(lp.walletAddress);
      if (balance === BigInt(0)) continue; // token doesn't exist on this chain or LP has none

      const tx = await contract.transfer(chainCfg.solverAddress, balance);
      await tx.wait(1);

      const humanAmount = formatUnits(balance, decimals);
      swept.push({ tokenAddress, symbol, amount: humanAmount });

      await db.insert(lpWalletTransactions).values({
        lpId: lp.id,
        chain,
        type: 'activation_sweep',
        source: 'system',
        tokenAddress,
        tokenSymbol: symbol,
        decimals,
        amount: humanAmount,
        txHash: tx.hash,
      }).catch((err) => console.error('[activate] failed to record sweep tx:', err));

      await db
        .insert(lpPoolPositions)
        .values({
          lpId: lp.id,
          chain,
          tokenAddress,
          tokenSymbol: symbol,
          decimals,
          contributed: humanAmount,
          earned: '0',
        })
        .onConflictDoUpdate({
          target: [lpPoolPositions.lpId, lpPoolPositions.chain, lpPoolPositions.tokenAddress],
          set: {
            contributed: sql`${lpPoolPositions.contributed} + ${humanAmount}::numeric`,
            updatedAt: new Date(),
          },
        });
    }

    if (swept.length === 0) {
      return NextResponse.json(
        { error: `No token balance found on ${chainCfg.chainName}. Please deposit tokens to your wallet first.` },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(lpAccounts)
      .set({ isActive: true, onboardingStep: 4, updatedAt: new Date() })
      .where(eq(lpAccounts.id, lp.id))
      .returning();

    return NextResponse.json({ lp: updated, swept, chain });
  } else {
    // ── DEACTIVATE: return contributed + earned back to LP wallet ────────────
    // Group positions by chain and return each via the correct solver
    const positions = await db
      .select()
      .from(lpPoolPositions)
      .where(eq(lpPoolPositions.lpId, lp.id));

    const returned: Array<{ tokenAddress: string; symbol: string; amount: string; chain: string }> = [];
    const failed: Array<{ tokenAddress: string; symbol: string; chain: string; reason: string }> = [];

    // Group by chain so we only create one provider per chain
    const byChain = new Map<ChainId, typeof positions>();
    for (const pos of positions) {
      const c = (pos.chain ?? 'base') as ChainId;
      if (!byChain.has(c)) byChain.set(c, []);
      byChain.get(c)!.push(pos);
    }

    for (const [posChain, chainPositions] of byChain) {
      let cfg: ReturnType<typeof getChainConfig>;
      try { cfg = getChainConfig(posChain); }
      catch { for (const pos of chainPositions) failed.push({ tokenAddress: pos.tokenAddress, symbol: pos.tokenSymbol, chain: posChain, reason: 'chain config missing' }); continue; }

      const solverKey = cfg.solverPrivateKey;
      if (!solverKey) { for (const pos of chainPositions) failed.push({ tokenAddress: pos.tokenAddress, symbol: pos.tokenSymbol, chain: posChain, reason: 'solver key not configured' }); continue; }

      const chainProvider = new JsonRpcProvider(cfg.rpcUrl);
      const solverSigner = new Wallet(solverKey, chainProvider);

      for (const pos of chainPositions) {
        try {
          // Truncate to token decimals before parseUnits — DB stores values with
          // full numeric precision (up to 18 dp) but tokens like USDC only have 6,
          // and ethers v6 throws "fractional component exceeds decimals" if the
          // stored value has non-zero digits beyond the token's decimal count.
          const truncate = (v: string, d: number) => {
            const [int, frac = ''] = v.split('.');
            return `${int}.${frac.slice(0, d).padEnd(d, '0')}`;
          };
          // Return `contributed` only. Under the double-entry fill model the LP's
          // realized profit is already baked into `contributed` (amountIn credited,
          // amountOut+fee debited), so adding `earned` on top would double-pay and
          // overdraw the solver. `earned` is deprecated as a payout component and
          // retained only for legacy/reporting; lifetime earnings come from lpFills.
          const totalWei = parseUnits(truncate(pos.contributed, pos.decimals), pos.decimals);

          // Nothing owed for this position — safe to clear the record.
          if (totalWei === BigInt(0)) {
            await db.delete(lpPoolPositions).where(eq(lpPoolPositions.id, pos.id));
            continue;
          }

          const contract = new Contract(pos.tokenAddress, ERC20_ABI, solverSigner);
          const solverBal: bigint = await contract.balanceOf(cfg.solverAddress);

          // Never delete a position we can't return IN FULL. Previously this sent
          // min(owed, solverBal) and then wiped every position unconditionally, so
          // a failed/partial return left the LP's funds stranded in the solver with
          // no record. Keep the position and report it so it can be retried.
          if (solverBal < totalWei) {
            failed.push({ tokenAddress: pos.tokenAddress, symbol: pos.tokenSymbol, chain: posChain, reason: 'insufficient solver balance to return in full' });
            continue;
          }

          const tx = await contract.transfer(lp.walletAddress, totalWei);
          await tx.wait(1);

          const returnedAmount = formatUnits(totalWei, pos.decimals);
          returned.push({ tokenAddress: pos.tokenAddress, symbol: pos.tokenSymbol, amount: returnedAmount, chain: posChain });

          await db.insert(lpWalletTransactions).values({
            lpId: lp.id,
            chain: posChain,
            type: 'deactivation_return',
            source: 'system',
            tokenAddress: pos.tokenAddress,
            tokenSymbol: pos.tokenSymbol,
            decimals: pos.decimals,
            amount: returnedAmount,
            txHash: tx.hash,
          }).catch((err) => console.error('[deactivate] failed to record return tx:', err));

          // Delete ONLY after the on-chain return is confirmed.
          await db.delete(lpPoolPositions).where(eq(lpPoolPositions.id, pos.id));
        } catch (err) {
          failed.push({ tokenAddress: pos.tokenAddress, symbol: pos.tokenSymbol, chain: posChain, reason: err instanceof Error ? err.message : 'return failed' });
        }
      }
    }

    // Only flip to inactive when EVERYTHING was returned. If anything failed,
    // keep the LP active (and its remaining positions intact) so it can be
    // retried — never strand funds with the account marked inactive.
    if (failed.length === 0) {
      const [updated] = await db
        .update(lpAccounts)
        .set({ isActive: false, onboardingStep: 3, updatedAt: new Date() })
        .where(eq(lpAccounts.id, lp.id))
        .returning();
      return NextResponse.json({ lp: updated, returned, failed });
    }

    return NextResponse.json(
      { lp, returned, failed, partial: true, error: 'Some positions could not be returned and were kept. Please retry.' },
      { status: 207 },
    );
  }
}
