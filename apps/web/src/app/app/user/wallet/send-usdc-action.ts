'use server'

import { and, eq } from 'drizzle-orm'
import { ethers } from 'ethers'

import { requireAnyRole, requireDbUser } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { wallets, users, auditLogs } from '@ntzs/db'
import { deriveWallet } from '@/lib/waas/hd-wallets'
import { sendTransaction as sendCdpTransaction } from '@/lib/waas/cdp-server'
import { BASE_RPC_URL } from '@/lib/env'

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_DECIMALS = 6
const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]

export type SendUsdcResult =
  | { success: true; txHash: string; amount: number; toAddress: string }
  | { success: false; error: string }

export async function sendUsdcAction(formData: FormData): Promise<SendUsdcResult> {
  await requireAnyRole(['end_user', 'super_admin'])
  const dbUser = await requireDbUser()

  const rawTo = String(formData.get('to') ?? '').trim()
  const rawAmount = String(formData.get('amount') ?? '').trim()

  if (!rawTo || !rawAmount) {
    return { success: false, error: 'Recipient and amount are required' }
  }
  if (!ethers.isAddress(rawTo)) {
    return { success: false, error: 'Invalid address — must be a valid 0x… EVM address' }
  }

  const amount = parseFloat(rawAmount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: 'Enter a valid amount' }
  }

  const { db } = getDb()

  const userWallets = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, dbUser.id))
    .limit(10)

  const wallet =
    userWallets.find((w) => w.provider === 'platform_hd') ??
    userWallets.find((w) => w.provider === 'coinbase_embedded') ??
    null

  if (!wallet) return { success: false, error: 'No wallet found for your account' }
  if (wallet.address.startsWith('0x_pending_')) {
    return { success: false, error: 'Your wallet is not ready yet' }
  }
  if (rawTo.toLowerCase() === wallet.address.toLowerCase()) {
    return { success: false, error: 'Cannot send to your own wallet' }
  }

  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider)

  const amountWei = ethers.parseUnits(amount.toFixed(USDC_DECIMALS), USDC_DECIMALS)
  const balanceWei: bigint = await usdc.balanceOf(wallet.address)

  if (balanceWei < amountWei) {
    const available = parseFloat(ethers.formatUnits(balanceWei, USDC_DECIMALS))
    return {
      success: false,
      error: `Insufficient balance — you have ${available.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`,
    }
  }

  let txHash: string

  if (wallet.provider === 'platform_hd') {
    const platformSeed = process.env.PLATFORM_HD_SEED
    if (!platformSeed) return { success: false, error: 'Platform not configured — contact support' }
    if (wallet.providerWalletRef === null) return { success: false, error: 'Wallet index not provisioned' }

    const walletIndex = parseInt(wallet.providerWalletRef ?? '0', 10)
    const hdWallet = deriveWallet(platformSeed, walletIndex)
    const signer = new ethers.Wallet(hdWallet.privateKey, provider)

    // Top up gas if needed
    const GAS_THRESHOLD = ethers.parseEther('0.00003')
    const GAS_TOPUP = ethers.parseEther('0.00005')
    const solverKey = process.env.SOLVER_PRIVATE_KEY
    const ethBalance = await provider.getBalance(wallet.address)
    if (ethBalance < GAS_THRESHOLD && solverKey) {
      const solver = new ethers.Wallet(solverKey, provider)
      const gasTx = await solver.sendTransaction({ to: wallet.address, value: GAS_TOPUP })
      await gasTx.wait()
    }

    const usdcWithSigner = usdc.connect(signer) as typeof usdc
    const tx = await (usdcWithSigner as any).transfer(rawTo, amountWei)
    await tx.wait()
    txHash = tx.hash
  } else if (wallet.provider === 'coinbase_embedded') {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, dbUser.id)).limit(1)
    if (!user) return { success: false, error: 'User not found' }

    const iface = new ethers.Interface(USDC_ABI)
    const result = await sendCdpTransaction(dbUser.id, user.email, {
      evmAccount: wallet.address,
      network: 'base',
      transaction: {
        type: 'eip1559',
        chainId: 8453,
        to: USDC_ADDRESS as `0x${string}`,
        data: iface.encodeFunctionData('transfer', [rawTo, amountWei]) as `0x${string}`,
        value: BigInt(0),
      },
    } as any)

    if ('error' in result) return { success: false, error: result.error }
    txHash = result.txHash
  } else {
    return { success: false, error: 'Wallet type not supported' }
  }

  await db.insert(auditLogs).values({
    action: 'user_send_usdc',
    entityType: 'transfer',
    entityId: txHash,
    metadata: { fromUserId: dbUser.id, fromWallet: wallet.address, toAddress: rawTo, amount, txHash },
  })

  return { success: true, txHash, amount, toAddress: rawTo }
}
