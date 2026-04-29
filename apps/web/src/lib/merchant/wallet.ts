import { HDNodeWallet, Mnemonic } from 'ethers';
import { db } from './db';
import { merchantNextWalletIndex } from '@ntzs/db';
import { sql } from 'drizzle-orm';

const DERIVATION_BASE = "m/44'/8453'/2'/0";

function getMnemonic(): string {
  const m = process.env.MERCHANT_HD_MNEMONIC ?? process.env.FX_HD_MNEMONIC;
  if (!m) throw new Error('MERCHANT_HD_MNEMONIC (or FX_HD_MNEMONIC) env var not set');
  return m;
}

export function deriveWallet(index: number): { address: string; privateKey: string } {
  const mnemonic = Mnemonic.fromPhrase(getMnemonic());
  const root = HDNodeWallet.fromMnemonic(mnemonic, `${DERIVATION_BASE}/${index}`);
  return { address: root.address, privateKey: root.privateKey };
}

export async function provisionMerchantWallet(): Promise<{ address: string; index: number }> {
  const [row] = await db
    .insert(merchantNextWalletIndex)
    .values({ id: 1, nextIndex: 1 })
    .onConflictDoUpdate({
      target: merchantNextWalletIndex.id,
      set: { nextIndex: sql`${merchantNextWalletIndex.nextIndex} + 1` },
    })
    .returning({ nextIndex: merchantNextWalletIndex.nextIndex });

  const index = row.nextIndex - 1;
  const { address } = deriveWallet(index);
  return { address, index };
}

export function slugFromEmail(email: string): string {
  return email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30);
}
