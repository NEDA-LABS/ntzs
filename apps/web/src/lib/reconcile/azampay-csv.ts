/**
 * AzamPay dashboard CSV ingestion — pure parsing/mapping (unit-tested).
 *
 * The dashboard's Transaction History export is the authoritative list of
 * what was actually PAID (Status = SUCCESS), keyed by BOTH sides' ids:
 * their "Transaction ID" (what TQS resolves) and our "Merchant Ref No"
 * (the externalId we generated — for the broken class it equals the
 * deposit's stored reference). The bulk reconcile joins on those exactly,
 * so it scales to thousands of attempts without fuzzy matching.
 */

/** Minimal quote-aware CSV parser (handles quoted commas, "" escapes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

export interface AzamCsvRow {
  transactionId: string
  merchantRef: string | null
  status: string
  amountTzs: number | null
  customerNo: string | null
  date: string | null
}

function findColumn(headers: string[], pattern: RegExp): number {
  return headers.findIndex((h) => pattern.test(h.trim().toLowerCase()))
}

/**
 * Map a parsed dashboard export to typed rows. Header names are matched
 * loosely (the export wording can drift from the UI). Returns null when the
 * required columns (transaction id + status) can't be located.
 */
export function mapAzamCsv(rows: string[][]): AzamCsvRow[] | null {
  if (rows.length < 2) return null
  const headers = rows[0].map((h) => h.trim().toLowerCase())

  const txCol = findColumn(headers, /^transaction\s*_?\s*id$/)
  const statusCol = findColumn(headers, /^status$/)
  if (txCol === -1 || statusCol === -1) return null

  const merchantCol = findColumn(headers, /merchant\s*ref/)
  const amountCol = findColumn(headers, /^amount/)
  const customerCol = findColumn(headers, /customer\s*no|msisdn|customer\s*number/)
  const dateCol = findColumn(headers, /^date$/)

  const out: AzamCsvRow[] = []
  const seen = new Set<string>()
  for (const r of rows.slice(1)) {
    const transactionId = (r[txCol] ?? '').trim()
    if (!transactionId || seen.has(transactionId)) continue
    seen.add(transactionId)

    const rawAmount = amountCol >= 0 ? (r[amountCol] ?? '').replace(/[,\s]/g, '') : ''
    const amount = rawAmount !== '' && Number.isFinite(Number(rawAmount)) ? Math.trunc(Number(rawAmount)) : null

    out.push({
      transactionId,
      merchantRef: merchantCol >= 0 ? (r[merchantCol] ?? '').trim() || null : null,
      status: (r[statusCol] ?? '').trim(),
      amountTzs: amount,
      customerNo: customerCol >= 0 ? (r[customerCol] ?? '').trim() || null : null,
      date: dateCol >= 0 ? (r[dateCol] ?? '').trim() || null : null,
    })
  }
  return out
}

/** The rows worth reconciling: payments AzamPay marks successful. */
export function successRows(rows: AzamCsvRow[]): AzamCsvRow[] {
  return rows.filter((r) => /success/i.test(r.status))
}
