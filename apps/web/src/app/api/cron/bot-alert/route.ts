import { NextRequest, NextResponse } from 'next/server'
import { sendEmail, GAS_ALERT_RECIPIENTS } from '@/lib/email'

const CRON_SECRET = process.env.CRON_SECRET || ''
const FLY_API_TOKEN = process.env.FLY_API_TOKEN || ''
const FLY_APP_NAME = 'ntzs-market-maker'

export const maxDuration = 30

interface FlyMachine {
  id: string
  state: 'started' | 'stopped' | 'suspended' | 'created' | 'destroying' | 'destroyed'
  updated_at: string
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const isVercelCron = request.headers.get('x-vercel-cron') === '1'

  if (CRON_SECRET && !isVercelCron && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!FLY_API_TOKEN) {
    return NextResponse.json({ error: 'FLY_API_TOKEN not configured' }, { status: 503 })
  }

  let machines: FlyMachine[] = []
  let fetchError: string | null = null

  try {
    const res = await fetch(`https://api.machines.dev/v1/apps/${FLY_APP_NAME}/machines`, {
      headers: { Authorization: `Bearer ${FLY_API_TOKEN}` },
    })
    if (!res.ok) {
      fetchError = `Fly.io API returned ${res.status}: ${await res.text()}`
    } else {
      machines = await res.json()
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Unknown fetch error'
  }

  // Determine overall status
  const hasRunning = machines.some(m => m.state === 'started')
  const allStopped = machines.length > 0 && machines.every(m => m.state === 'stopped' || m.state === 'suspended')
  const noMachines = machines.length === 0

  const isHealthy = !fetchError && hasRunning

  if (isHealthy) {
    return NextResponse.json({
      status: 'ok',
      message: `Market-maker bot is running (${machines.filter(m => m.state === 'started').length} machine(s) active)`,
      machines: machines.map(m => ({ id: m.id, state: m.state })),
    })
  }

  // Build alert
  let statusLabel: string
  let statusColor: string
  let statusDetail: string
  let isCritical = true

  if (fetchError) {
    statusLabel = 'UNREACHABLE'
    statusColor = '#ef4444'
    statusDetail = `Could not reach Fly.io API: ${fetchError}`
  } else if (noMachines) {
    statusLabel = 'NO MACHINES'
    statusColor = '#ef4444'
    statusDetail = 'No machines found for this app. The bot may have been deleted or never deployed.'
  } else if (allStopped) {
    statusLabel = 'STOPPED'
    statusColor = '#f59e0b'
    statusDetail = `All ${machines.length} machine(s) are stopped or suspended.`
    isCritical = false
  } else {
    statusLabel = 'DEGRADED'
    statusColor = '#f59e0b'
    statusDetail = machines.map(m => `Machine ${m.id}: ${m.state}`).join(', ')
    isCritical = false
  }

  const subject = isCritical
    ? `[CRITICAL] nTZS Market-Maker Bot is DOWN`
    : `[WARNING] nTZS Market-Maker Bot is ${statusLabel}`

  const machineRows = machines.length > 0
    ? machines.map(m => {
        const color = m.state === 'started' ? '#10b981' : m.state === 'stopped' ? '#f59e0b' : '#ef4444'
        return `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-family:monospace;font-size:12px;color:#a1a1aa">${m.id}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #27272a">
            <span style="background:${color}22;color:${color};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700">${m.state.toUpperCase()}</span>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-size:12px;color:#71717a">${new Date(m.updated_at).toUTCString()}</td>
        </tr>`
      }).join('')
    : `<tr><td colspan="3" style="padding:12px;color:#71717a;font-size:13px">No machines found</td></tr>`

  const html = `
    <div style="background:#09090b;padding:32px;font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;border-radius:12px">
      <div style="margin-bottom:24px">
        <h1 style="color:#fff;font-size:20px;margin:0 0 4px">${isCritical ? '🚨' : '⚠️'} Market-Maker Bot Alert</h1>
        <p style="color:#71717a;margin:0;font-size:14px">The nTZS automated market-maker bot needs attention</p>
      </div>

      <div style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:16px;margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span style="background:${statusColor}22;color:${statusColor};padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700">${statusLabel}</span>
          <span style="color:#71717a;font-size:13px">${FLY_APP_NAME}</span>
        </div>
        <p style="color:#a1a1aa;font-size:13px;margin:0">${statusDetail}</p>
      </div>

      ${machines.length > 0 ? `
      <table style="width:100%;border-collapse:collapse;background:#18181b;border-radius:8px;overflow:hidden;margin-bottom:24px">
        <thead>
          <tr style="background:#27272a">
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.05em">Machine ID</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.05em">State</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.05em">Last Updated</th>
          </tr>
        </thead>
        <tbody>${machineRows}</tbody>
      </table>` : ''}

      <div style="background:#18181b;border:1px solid #27272a;border-radius:8px;padding:16px;margin-bottom:24px">
        <p style="color:#fff;font-weight:600;margin:0 0 10px;font-size:14px">How to restart the bot</p>
        <ol style="color:#a1a1aa;font-size:13px;margin:0;padding-left:16px;line-height:1.8">
          <li>Install Fly CLI: <code style="background:#27272a;padding:2px 6px;border-radius:4px">brew install flyctl</code></li>
          <li>Authenticate: <code style="background:#27272a;padding:2px 6px;border-radius:4px">fly auth login</code></li>
          <li>Restart: <code style="background:#27272a;padding:2px 6px;border-radius:4px">fly machines restart --app ${FLY_APP_NAME}</code></li>
          <li>Check logs: <code style="background:#27272a;padding:2px 6px;border-radius:4px">fly logs --app ${FLY_APP_NAME}</code></li>
        </ol>
      </div>

      <div style="border-top:1px solid #27272a;padding-top:16px">
        <p style="color:#52525b;font-size:12px;margin:0">
          This alert is sent every 30 minutes when the bot is unhealthy. Check the Fly.io dashboard for more details.
        </p>
      </div>
    </div>
  `

  await sendEmail({
    to: GAS_ALERT_RECIPIENTS,
    subject,
    html,
  })

  console.log(`[cron/bot-alert] Alert sent — status: ${statusLabel}, machines: ${machines.length}`)

  return NextResponse.json({
    status: 'alert_sent',
    botStatus: statusLabel,
    machines: machines.map(m => ({ id: m.id, state: m.state })),
  })
}
