'use client'

import { useState } from 'react'

import type { Report } from '@/lib/bot-report/figures'
import { buildReturnDocument, renderReturnPdf, returnPdfFilename } from '@/lib/bot-report/pdf'

/**
 * Produces the return as a letter in the house style, ready to attach to an
 * email to the Bank.
 *
 * The logo is fetched rather than inlined so the letterhead mark stays the one
 * file every other NEDA Labs document uses; if it cannot be fetched the letter
 * still renders, with the wordmark alone. A missing image is not a reason to
 * withhold a document someone is waiting to send.
 */

/** The mark used on every letter this Bank already holds. */
const LOGO_URL = '/ntzs-logo.png'

async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch(LOGO_URL)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export function ExportReturnButton({
  report,
  warnings,
}: {
  report: Report
  warnings: Array<{ section: string; label: string; note: string }>
}) {
  const [busy, setBusy] = useState(false)
  const isDraft = warnings.length > 0

  const onExport = async () => {
    setBusy(true)
    try {
      const logo = await loadLogo()
      const blocks = buildReturnDocument(report, { warnings })
      const doc = renderReturnPdf(blocks, { logo, draft: isDraft })
      doc.save(returnPdfFilename(report))
    } catch (err) {
      console.error('[bot-report] PDF export failed:', err)
      alert('The PDF could not be generated. The error is in the browser console.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={onExport}
        disabled={busy}
        className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-40"
      >
        {busy ? 'Preparing…' : 'Download as PDF'}
      </button>
      <span className="text-[11px] text-zinc-500">
        {isDraft
          ? `stamped DRAFT — ${warnings.length} item${warnings.length === 1 ? '' : 's'} to clear`
          : 'house letterhead · signature block included'}
      </span>
    </div>
  )
}
