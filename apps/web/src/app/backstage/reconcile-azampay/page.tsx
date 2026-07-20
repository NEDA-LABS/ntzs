import { and, eq, lt, ne, desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireAnyRole, getCurrentDbUser } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { writeAuditLog } from '@/lib/audit'
import { checkPaymentStatus } from '@/lib/psp/azampay'
import { parseCsv, mapAzamCsv, successRows } from '@/lib/reconcile/azampay-csv'
import { depositRequests } from '@ntzs/db'
import { SubmitButton } from '../_components/SubmitButton'

const SAFE_MINT_THRESHOLD_TZS = 1000000
// TQS verification is one HTTP call per row — bounded per run so the action
// stays well inside serverless limits. Re-run the sweep to continue.
const VERIFY_CAP_PER_RUN = 50
const STALE_CANCEL_AGE_HOURS = 72

async function sweepCsvAction(formData: FormData) {
  'use server'

  await requireAnyRole(['super_admin'])
  const currentUser = await getCurrentDbUser()

  const file = formData.get('csvFile')
  let text = ''
  if (file instanceof File && file.size > 0) {
    text = await file.text()
  } else {
    text = String(formData.get('csvText') ?? '')
  }
  if (!text.trim()) throw new Error('Upload the dashboard CSV export or paste its contents')

  const mapped = mapAzamCsv(parseCsv(text))
  if (!mapped) {
    throw new Error('Could not find the "Transaction ID" and "Status" columns — export the Transaction History CSV from the AzamPay dashboard unmodified')
  }
  const paid = successRows(mapped)

  const { db, sql } = getDb()

  let minted = 0
  let alreadyProcessed = 0
  let noMatch = 0
  let verifyFailed = 0
  let amountMismatch = 0
  let refConflict = 0
  let verified = 0

  for (const row of paid) {
    if (verified >= VERIFY_CAP_PER_RUN) break

    // ── Locate the deposit: their Merchant Ref No is OUR reference ──
    let deposit: typeof depositRequests.$inferSelect | undefined
    if (row.merchantRef) {
      ;[deposit] = await db
        .select()
        .from(depositRequests)
        .where(eq(depositRequests.pspReference, row.merchantRef))
        .limit(1)
      if (!deposit) {
        // externalId is recorded at initiation as a psp_initiated audit row
        try {
          const rows2 = await sql<Array<{ entity_id: string }>>`
            select entity_id from audit_logs
             where action = 'deposit.psp_initiated' and metadata->>'externalId' = ${row.merchantRef}
             order by created_at desc limit 1
          `
          if (rows2[0]?.entity_id) {
            ;[deposit] = await db
              .select()
              .from(depositRequests)
              .where(eq(depositRequests.id, rows2[0].entity_id))
              .limit(1)
          }
        } catch {
          // best-effort
        }
      }
    }
    if (!deposit) {
      ;[deposit] = await db
        .select()
        .from(depositRequests)
        .where(eq(depositRequests.pspReference, row.transactionId))
        .limit(1)
    }

    if (!deposit) {
      noMatch++
      continue
    }
    if (deposit.status !== 'submitted') {
      alreadyProcessed++
      continue
    }
    if (row.amountTzs !== null && row.amountTzs < deposit.amountTzs) {
      amountMismatch++
      await writeAuditLog('deposit.reconcile_amount_mismatch', 'deposit_request', deposit.id, {
        csvAmount: row.amountTzs,
        depositAmount: deposit.amountTzs,
        transactionId: row.transactionId,
      }, currentUser?.id)
      continue
    }

    // ── The CSV is a claim; TQS (our credentials) is the oracle ──
    verified++
    const status = await checkPaymentStatus(row.transactionId, deposit.pspChannel ?? undefined)
    if (status.status !== 'completed') {
      verifyFailed++
      await writeAuditLog('deposit.reconcile_verify_failed', 'deposit_request', deposit.id, {
        transactionId: row.transactionId,
        tqsStatus: status.status,
        raw: status.raw ?? null,
      }, currentUser?.id)
      continue
    }

    // One reference credits at most one deposit.
    if (row.transactionId !== deposit.pspReference) {
      const [taken] = await db
        .select({ id: depositRequests.id })
        .from(depositRequests)
        .where(and(eq(depositRequests.pspReference, row.transactionId), ne(depositRequests.id, deposit.id)))
        .limit(1)
      if (taken) {
        refConflict++
        continue
      }
    }

    const newStatus = deposit.amountTzs >= SAFE_MINT_THRESHOLD_TZS ? 'mint_requires_safe' : 'mint_pending'
    const claimed = await db
      .update(depositRequests)
      .set({
        status: newStatus,
        pspReference: row.transactionId,
        fiatConfirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(depositRequests.id, deposit.id), eq(depositRequests.status, 'submitted')))
      .returning({ id: depositRequests.id })
    if (claimed.length === 0) {
      alreadyProcessed++
      continue
    }
    await writeAuditLog('deposit.reconciled_bulk', 'deposit_request', deposit.id, {
      transactionId: row.transactionId,
      merchantRef: row.merchantRef,
      verifiedVia: 'tqs',
      newStatus,
    }, currentUser?.id)
    minted++
  }

  const remaining = Math.max(0, paid.length - verified - minted - alreadyProcessed - noMatch - amountMismatch - refConflict)
  revalidatePath('/backstage/reconcile-azampay')
  redirect(
    `/backstage/reconcile-azampay?swept=1&paid=${paid.length}&minted=${minted}&already=${alreadyProcessed}&nomatch=${noMatch}&vfail=${verifyFailed}&amt=${amountMismatch}&conflict=${refConflict}&capped=${verified >= VERIFY_CAP_PER_RUN ? 1 : 0}&remaining=${remaining}`
  )
}

async function cancelStaleAttemptsAction() {
  'use server'

  await requireAnyRole(['super_admin'])
  const currentUser = await getCurrentDbUser()

  const { db } = getDb()
  const cutoff = new Date(Date.now() - STALE_CANCEL_AGE_HOURS * 3600_000)

  const cancelled = await db
    .update(depositRequests)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(depositRequests.status, 'submitted'),
        eq(depositRequests.paymentProvider, 'azampay'),
        lt(depositRequests.createdAt, cutoff)
      )
    )
    .returning({ id: depositRequests.id })

  await writeAuditLog('deposit.stale_attempts_cancelled', 'deposit_request', 'bulk', {
    count: cancelled.length,
    olderThanHours: STALE_CANCEL_AGE_HOURS,
    provider: 'azampay',
  }, currentUser?.id)

  revalidatePath('/backstage/reconcile-azampay')
  redirect(`/backstage/reconcile-azampay?cancelled=${cancelled.length}`)
}

export const dynamic = 'force-dynamic'

export default async function ReconcileAzamPayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const { db } = getDb()

  const stale = await db
    .select({ id: depositRequests.id, amountTzs: depositRequests.amountTzs, createdAt: depositRequests.createdAt })
    .from(depositRequests)
    .where(and(eq(depositRequests.status, 'submitted'), eq(depositRequests.paymentProvider, 'azampay')))
    .orderBy(desc(depositRequests.createdAt))
    .limit(500)

  const cutoff = Date.now() - STALE_CANCEL_AGE_HOURS * 3600_000
  const staleCount = stale.filter((d) => new Date(d.createdAt as unknown as string | Date).getTime() < cutoff).length

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-semibold text-white">AzamPay Reconciliation</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Bulk-clear the gap between AzamPay&apos;s books and ours. Every credited row is verified against
        AzamPay&apos;s status API before minting — the CSV is a claim, their API is the oracle.
      </p>

      {params.swept ? (
        <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          <p className="font-medium">Sweep complete.</p>
          <p className="mt-1">
            {params.paid} successful payments in file · <strong>{params.minted} credited → minting</strong> ·{' '}
            {params.already} already processed · {params.nomatch} no matching deposit · {params.vfail} failed
            AzamPay verification · {params.amt} amount mismatches · {params.conflict} reference conflicts.
          </p>
          {params.capped === '1' ? (
            <p className="mt-1 text-amber-300">
              Verification cap ({VERIFY_CAP_PER_RUN}/run) reached with ~{params.remaining} rows left — run the same
              file again to continue; already-credited rows are skipped automatically.
            </p>
          ) : null}
        </div>
      ) : null}
      {params.cancelled ? (
        <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          Cancelled {params.cancelled} stale unpaid attempts (older than {STALE_CANCEL_AGE_HOURS}h).
        </div>
      ) : null}

      <div className="mt-6 rounded-xl border border-white/10 bg-zinc-900/60 p-6">
        <h2 className="text-lg font-medium text-white">Step 1 — Sweep the dashboard export</h2>
        <ol className="mt-2 list-decimal pl-5 text-sm text-zinc-400">
          <li>AzamPay dashboard → Transaction History → export CSV (all pages, any date range).</li>
          <li>Upload it here. Rows with Status = SUCCESS are matched to deposits by their Merchant Ref No (our reference), verified via AzamPay&apos;s API, then credited — mints follow automatically within a minute.</li>
        </ol>
        <form action={sweepCsvAction} className="mt-4 space-y-3">
          <input
            type="file"
            name="csvFile"
            accept=".csv,text/csv"
            className="block w-full text-sm text-zinc-400 file:mr-4 file:rounded-lg file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-white/20"
          />
          <textarea
            name="csvText"
            rows={4}
            placeholder="…or paste the CSV contents here"
            className="w-full rounded-lg border border-white/10 bg-zinc-950 p-3 font-mono text-xs text-zinc-300 placeholder:text-zinc-600"
          />
          <SubmitButton className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/30">
            Verify &amp; credit paid deposits
          </SubmitButton>
        </form>
      </div>

      <div className="mt-6 rounded-xl border border-white/10 bg-zinc-900/60 p-6">
        <h2 className="text-lg font-medium text-white">Step 2 — Clear the unpaid noise</h2>
        <p className="mt-2 text-sm text-zinc-400">
          After the sweep has credited everything AzamPay marks successful, the remaining{' '}
          <span className="text-zinc-200">{staleCount}</span> submitted AzamPay attempts older than{' '}
          {STALE_CANCEL_AGE_HOURS}h are abandonment (no PIN, insufficient balance, closed app) — cancel them in
          bulk so the queue only ever shows live work. Run this <em>only after</em> Step 1.
        </p>
        <form action={cancelStaleAttemptsAction} className="mt-4">
          <SubmitButton className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20">
            Cancel {staleCount} stale attempts (&gt;{STALE_CANCEL_AGE_HOURS}h)
          </SubmitButton>
        </form>
      </div>

      <p className="mt-6 text-xs text-zinc-600">
        Going forward this page should rarely be needed: deposits store AzamPay&apos;s resolvable transaction id at
        initiation, their callbacks are accepted (verify-then-mint), the poll resolves the rest within a minute,
        and attempts AzamPay marks failed are auto-rejected. Every action here writes an audit row.
      </p>
    </div>
  )
}
