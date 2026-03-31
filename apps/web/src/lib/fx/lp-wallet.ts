import { HDNodeWallet, Mnemonic } from 'ethers';
import { db } from './db';
import { lpNextWalletIndex } from '@ntzs/db';
import { sql } from 'drizzle-orm';

const DERIVATION_BASE = "m/44'/8453'/1'/0";

function getMnemonic(): string {
  const m = process.env.FX_HD_MNEMONIC;
  if (!m) throw new Error('FX_HD_MNEMONIC env var not set');
  return m;
}

export function deriveWallet(index: number): { address: string; privateKey: string } {
  const mnemonic = Mnemonic.fromPhrase(getMnemonic());
  const root = HDNodeWallet.fromMnemonic(mnemonic, `${DERIVATION_BASE}/${index}`);
  return { address: root.address, privateKey: root.privateKey };
}

export async function provisionLpWallet(): Promise<{ address: string; index: number }> {
  const [row] = await db
    .insert(lpNextWalletIndex)
    .values({ id: 1, nextIndex: 1 })
    .onConflictDoUpdate({
      target: lpNextWalletIndex.id,
      set: { nextIndex: sql`${lpNextWalletIndex.nextIndex} + 1` },
    })
    .returning({ nextIndex: lpNextWalletIndex.nextIndex });

  const index = row.nextIndex - 1;
  const { address } = deriveWallet(index);
  return { address, index };
}
