import { ethers } from 'ethers'

/**
 * How much a participant can actually withdraw, defined once.
 *
 * The withdrawal screen used to show no balance at all: the participant typed
 * an amount cold, and until the balance check moved ahead of the approval
 * branch, a request for money they did not hold was accepted and queued. Three
 * of those sat for six weeks and reached a regulatory return.
 *
 * The subtle part, and the reason this is shared rather than duplicated: a burn
 * comes out of ONE wallet. A participant holding 600,000 in each of two wallets
 * cannot withdraw 1,200,000 — the executor looks for a single wallet holding
 * the whole amount. Showing the sum would put a number on the screen that the
 * backend refuses, which is the same class of defect as showing nothing, only
 * more insulting. The figure offered is therefore the largest single-wallet
 * balance, and the split is reported separately so the participant can be told
 * the truth rather than left to guess.
 */

const BALANCE_ABI = ['function balanceOf(address) view returns (uint256)']

export interface WalletRef {
  address: string
}

export interface Availability<T extends WalletRef> {
  /** The most that can be withdrawn in one request — the largest single wallet. */
  maxTzs: number
  /** The wallet holding it, or null when the participant holds nothing. */
  fundedWallet: T | null
  /** Everything held across all wallets. Equal to maxTzs in the ordinary case. */
  totalTzs: number
  /** True when the holding is spread, so maxTzs is less than totalTzs. */
  splitAcrossWallets: boolean
}

/** Whole shillings held by one address. Fractional dust is not withdrawable. */
function toWholeTzs(wei: bigint): number {
  return Number(wei / BigInt(10) ** BigInt(18))
}

/**
 * Read every wallet the participant holds and report what is withdrawable.
 *
 * Iterating all wallets rather than a chosen one matters: tokens minted to a
 * CDP address before the HD migration live on a wallet that is not the default
 * selection, and checking only the default would refuse a withdrawal the
 * participant can genuinely fund.
 */
export async function readAvailability<T extends WalletRef>(
  walletList: T[],
  opts: { rpcUrl: string; contractAddress: string }
): Promise<Availability<T>> {
  if (!walletList.length) {
    return { maxTzs: 0, fundedWallet: null, totalTzs: 0, splitAcrossWallets: false }
  }

  const provider = new ethers.JsonRpcProvider(opts.rpcUrl)
  const token = new ethers.Contract(opts.contractAddress, BALANCE_ABI, provider)

  const balances = await Promise.all(
    walletList.map(async (w) => ({ wallet: w, tzs: toWholeTzs(await token.balanceOf(w.address)) }))
  )

  const best = balances.reduce((a, b) => (b.tzs > a.tzs ? b : a))
  const totalTzs = balances.reduce((sum, b) => sum + b.tzs, 0)

  return {
    maxTzs: best.tzs,
    fundedWallet: best.tzs > 0 ? best.wallet : null,
    totalTzs,
    splitAcrossWallets: totalTzs > best.tzs,
  }
}

/**
 * The refusal a participant sees when the amount is not there.
 *
 * Written here so the screen's figure and the action's refusal can never
 * describe different worlds — and so the split case is explained rather than
 * looking like the platform has lost money the participant knows they hold.
 */
export function insufficientBalanceMessage(
  availability: Pick<Availability<WalletRef>, 'maxTzs' | 'totalTzs' | 'splitAcrossWallets'>,
  needTzs: number,
  receiveTzs: number
): string {
  const base =
    `Insufficient balance. You have ${availability.maxTzs.toLocaleString()} nTZS available but need ` +
    `${needTzs.toLocaleString()} nTZS to withdraw ${receiveTzs.toLocaleString()} TZS (including fees).`

  if (!availability.splitAcrossWallets) return base

  return (
    `${base} You hold ${availability.totalTzs.toLocaleString()} nTZS in total, spread across more than one wallet, ` +
    'and a withdrawal is paid from a single wallet. Contact support to consolidate them.'
  )
}
