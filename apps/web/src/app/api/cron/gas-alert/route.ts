import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { sendEmail, GAS_ALERT_RECIPIENTS } from '@/lib/email'

const CRON_SECRET = process.env.CRON_SECRET || ''
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org'
const MINTER_PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY || ''
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || ''

const CRITICAL_THRESHOLD = 0.001
const LOW_THRESHOLD = 0.005

export const maxDuration = 30

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const isVercelCron = request.headers.get('x-vercel-cron') === '1'

  if (CRON_SECRET && !isVercelCron && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL)

  type WalletInfo = {
    name: string
    address: string
    balance: number
    status: 'ok' | 'low' | 'critical' | 'unconfigured'
  }

  const walletInfos: WalletInfo[] = []

  try {
    if (MINTER_PRIVATE_KEY) {
      const minterAddress = new ethers.Wallet(MINTER_PRIVATE_KEY).address
      const raw = await provider.getBalance(minterAddress)
      const balance = parseFloat(ethers.formatEther(raw))
      walletInfos.push({
        name: 'Minter',
        address: minterAddress,
        balance,
        status: balance < CRITICAL_THRESHOLD ? 'critical' : balance < LOW_THRESHOLD ? 'low' : 'ok',
      })
    } else {
      walletInfos.push({ name: 'Minter', address: '', balance: 0, status: 'unconfigured' })
    }

    if (RELAYER_PRIVATE_KEY) {
      const relayerAddress = new ethers.Wallet(RELAYER_PRIVATE_KEY).address
      const raw = await provider.getBalance(relayerAddress)
      const balance = parseFloat(ethers.formatEther(raw))
      walletInfos.push({
        name: 'Relayer',
        address: relayerAddress,
        balance,
        status: balance < CRITICAL_THRESHOLD ? 'critical' : balance < LOW_THRESHOLD ? 'low' : 'ok',
      })
    } else {
      walletInfos.push({ name: 'Relayer', address: '', balance: 0, status: 'unconfigured' })
    }
  } catch (err) {
    console.error('[cron/gas-alert] Failed to fetch balances:', err instanceof Error ? err.message : err)
    return NextResponse.json({ status: 'error', error: 'Failed to fetch wallet balances' }, { status: 500 })
  }

  const alertWallets = walletInfos.filter(w => w.status === 'critical' || w.status === 'low' || w.status === 'unconfigured')

  if (alertWallets.length === 0) {
    return NextResponse.json({ status: 'ok', message: 'All gas wallets healthy', wallets: walletInfos })
  }

  const hasCritical = alertWallets.some(w => w.status === 'critical')
  const subject = hasCritical
    ? '[CRITICAL] nTZS Gas Wallet Low — Action Required Now'
    : '[WARNING] nTZS Gas Wallet Running Low'

  const rows = walletInfos.map(w => {
    const statusColor = w.status === 'critical' ? '#ef4444' : w.status === 'low' ? '#f59e0b' : w.status === 'ok' ? '#10b981' : '#6b7280'
    const statusLabel = w.status === 'critical' ? 'CRITICAL' : w.status === 'low' ? 'LOW' : w.status === 'ok' ? 'OK' : 'NOT CONFIGURED'
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-weight:600;color:#fff">${w.name} Wallet</td>
        <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-family:monospace;font-size:12px;color:#a1a1aa">${w.address || '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #27272a;color:#fff">${w.status !== 'unconfigured' ? w.balance.toFixed(6) + ' ETH' : '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #27272a">
          <span style="background:${statusColor}22;color:${statusColor};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700">${statusLabel}</span>
        </td>
      </tr>`
  }).join('')

  const actionRows = alertWallets
    .filter(w => w.status !== 'ok' && w.address)
    .map(w => `<li style="margin-bottom:6px">Send ETH to <strong>${w.name}</strong> wallet on Base mainnet:<br>
      <code style="background:#27272a;padding:3px 8px;border-radius:4px;font-size:12px">${w.address}</code>
    </li>`).join('')

  const html = `
    <div style="background:#09090b;padding:32px;font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;border-radius:12px">
      <div style="margin-bottom:24px">
        <h1 style="color:#fff;font-size:20px;margin:0 0 4px">${hasCritical ? '🚨' : '⚠️'} Gas Wallet Alert</h1>
        <p style="color:#71717a;margin:0;font-size:14px">One or more nTZS platform wallets need attention</p>
      </div>

      <table style="width:100%;border-collapse:collapse;background:#18181b;border-radius:8px;overflow:hidden;margin-bottom:24px">
        <thead>
          <tr style="background:#27272a">
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.05em">Wallet</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.05em">Address</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.05em">Balance</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.05em">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      ${actionRows ? `
      <div style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:16px;margin-bottom:24px">
        <p style="color:#fff;font-weight:600;margin:0 0 12px;font-size:14px">Action Required</p>
        <ul style="color:#a1a1aa;font-size:13px;margin:0;padding-left:16px">${actionRows}</ul>
        <p style="color:#52525b;font-size:12px;margin:16px 0 0">Recommended minimum: 0.01 ETH per wallet. Use any exchange that supports Base network withdrawals.</p>
      </div>` : ''}

      <div style="border-top:1px solid #27272a;padding-top:16px">
        <p style="color:#52525b;font-size:12px;margin:0">
          View live status: <a href="https://www.ntzs.co.tz/backstage/gas" style="color:#3b82f6">ntzs.co.tz/backstage/gas</a>
        </p>
      </div>
    </div>
  `

  await sendEmail({
    to: GAS_ALERT_RECIPIENTS,
    subject,
    html,
  })

  console.log(`[cron/gas-alert] Alert sent to ${GAS_ALERT_RECIPIENTS.length} recipients for wallets: ${alertWallets.map(w => w.name).join(', ')}`)

  return NextResponse.json({
    status: 'alert_sent',
    alertWallets: alertWallets.map(w => ({ name: w.name, balance: w.balance, status: w.status })),
  })
}
