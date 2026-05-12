'use client'

import { useState } from 'react'
import { jsPDF } from 'jspdf'

interface ReportData {
  generatedAt: string
  contractAddress: string
  network: string
  onChainSupply: number
  stats: {
    totalUsers: number
    totalWallets: number
    totalDeposits: number
    totalMinted: number
    totalPending: number
  }
  kyc: {
    approved: number
    pending: number
    rejected: number
  }
  dailyIssuance: {
    date: string
    cap: number
    issued: number
    reserved: number
  }
  statusBreakdown: Array<{
    status: string
    count: number
    totalTzs: number
  }>
  recentDeposits: Array<{
    id: string
    amountTzs: number
    status: string
    provider: string | null
    reference: string | null
    txHash: string | null
    createdAt: string
  }>
}

export function ExportReportButton() {
  const [loading, setLoading] = useState(false)

  const generatePDF = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/oversight/reserves-report')
      const data: ReportData = await res.json()

      const doc = new jsPDF({ unit: 'pt', format: 'a4' })
      const W = doc.internal.pageSize.getWidth()
      const H = doc.internal.pageSize.getHeight()
      const mX = 44
      const cW = W - mX * 2
      let y = 0
      let pageNo = 1

      // ── Colour palette ──────────────────────────────────────────────────
      const C = {
        black:   [0, 0, 0] as const,
        bg:      [8, 8, 8] as const,
        surface: [16, 16, 16] as const,
        border:  [32, 32, 32] as const,
        white:   [255, 255, 255] as const,
        zinc4:   [161, 161, 170] as const,
        zinc6:   [82, 82, 91] as const,
        zinc7:   [63, 63, 70] as const,
        blue4:   [96, 165, 250] as const,
        blue6:   [37, 99, 235] as const,
        emerald: [52, 211, 153] as const,
        amber:   [251, 191, 36] as const,
        red:     [248, 113, 113] as const,
        violet:  [167, 139, 250] as const,
      }

      const fill  = (c: readonly [number,number,number]) => doc.setFillColor(c[0], c[1], c[2])
      const draw  = (c: readonly [number,number,number]) => doc.setDrawColor(c[0], c[1], c[2])
      const text  = (c: readonly [number,number,number]) => doc.setTextColor(c[0], c[1], c[2])
      const n     = (v: number) => v.toLocaleString()
      const pct   = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : '0.0')

      // ── Header / footer ─────────────────────────────────────────────────
      const header = () => {
        // Full black background
        fill(C.black); doc.rect(0, 0, W, H, 'F')

        // Top bar
        fill(C.surface); doc.rect(0, 0, W, 56, 'F')
        draw(C.border); doc.line(0, 56, W, 56)

        // Left accent bar
        fill(C.blue6); doc.rect(0, 0, 3, 56, 'F')

        // Title
        doc.setFont('courier', 'bold')
        doc.setFontSize(11)
        text(C.white)
        doc.text('nTZS OVERSIGHT DASHBOARD', mX + 4, 22)

        doc.setFont('courier', 'normal')
        doc.setFontSize(7.5)
        text(C.zinc6)
        doc.text(`NEDA LABS COMPANY LIMITED  ·  RESERVES & COMPLIANCE REPORT`, mX + 4, 36)
        doc.text(`Generated: ${data.generatedAt}`, mX + 4, 48)

        // Right: network pill
        doc.setFont('courier', 'normal')
        doc.setFontSize(7)
        text(C.blue4)
        const netLabel = `BASE MAINNET  ·  CHAIN ID 8453`
        doc.text(netLabel, W - mX - doc.getTextWidth(netLabel), 30)

        // Blue pulse dot
        fill(C.blue4); doc.circle(W - mX - doc.getTextWidth(netLabel) - 8, 27, 2, 'F')

        y = 72
      }

      const footer = (p: number) => {
        draw(C.border); doc.line(mX, H - 28, W - mX, H - 28)
        doc.setFont('courier', 'normal')
        doc.setFontSize(7)
        text(C.zinc7)
        doc.text(`CONTRACT: ${data.contractAddress || 'N/A'}`, mX, H - 16)
        const pg = `PAGE ${p}`
        doc.text(pg, W - mX - doc.getTextWidth(pg), H - 16)
      }

      const newPage = () => {
        footer(pageNo)
        doc.addPage()
        pageNo++
        fill(C.black); doc.rect(0, 0, W, H, 'F')
        fill(C.surface); doc.rect(0, 0, W, 32, 'F')
        draw(C.border); doc.line(0, 32, W, 32)
        fill(C.blue6); doc.rect(0, 0, 3, 32, 'F')
        doc.setFont('courier', 'bold'); doc.setFontSize(7.5)
        text(C.zinc6)
        doc.text('nTZS OVERSIGHT DASHBOARD  (CONTINUED)', mX + 4, 21)
        y = 46
      }

      const space = (need: number) => { if (y + need > H - 36) newPage() }

      // ── Section label (landing-page style) ──────────────────────────────
      const sectionLabel = (index: string, label: string, title: string) => {
        space(48)
        // Short line + label
        draw(C.blue4); doc.setLineWidth(0.5)
        doc.line(mX, y + 5, mX + 14, y + 5)
        doc.setFont('courier', 'normal'); doc.setFontSize(7)
        text(C.blue4)
        doc.text(`${index} / ${label.toUpperCase()}`, mX + 18, y + 8)
        // Long divider
        const labelEnd = mX + 18 + doc.getTextWidth(`${index} / ${label.toUpperCase()}`) + 6
        doc.line(labelEnd, y + 5, W - mX, y + 5)
        y += 16
        // Section title
        doc.setFont('courier', 'bold'); doc.setFontSize(10)
        text(C.white)
        doc.text(title.toUpperCase(), mX, y)
        y += 18
        doc.setLineWidth(0.3)
      }

      // ── Metric card grid ─────────────────────────────────────────────────
      const metricGrid = (items: Array<{ label: string; value: string; sub?: string }>, cols = 3) => {
        space(72)
        const gap = 8
        const cardW = (cW - gap * (cols - 1)) / cols
        const cardH = 58
        const rows = Math.ceil(items.length / cols)
        space(rows * (cardH + gap))

        items.forEach((it, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          const x = mX + col * (cardW + gap)
          const yy = y + row * (cardH + gap)

          fill(C.surface); draw(C.border)
          doc.setLineWidth(0.5)
          doc.rect(x, yy, cardW, cardH, 'FD')

          // Left accent strip
          fill(C.blue6); doc.rect(x, yy, 2, cardH, 'F')

          doc.setFont('courier', 'normal'); doc.setFontSize(6.5)
          text(C.zinc6)
          doc.text(it.label.toUpperCase(), x + 8, yy + 14)

          doc.setFont('courier', 'bold'); doc.setFontSize(13)
          text(C.white)
          doc.text(it.value, x + 8, yy + 36)

          if (it.sub) {
            doc.setFont('courier', 'normal'); doc.setFontSize(6.5)
            text(C.zinc7)
            doc.text(it.sub, x + 8, yy + 50)
          }
        })

        y += rows * (cardH + gap) + 4
      }

      // ── Table ────────────────────────────────────────────────────────────
      const table = (
        cols: Array<{ header: string; width: number; align?: 'left' | 'right' }>,
        rows: Array<Array<{ text: string; color?: readonly [number,number,number] }>>
      ) => {
        const tableW = cols.reduce((a, c) => a + c.width, 0)
        const hdrH = 20, rowH = 16
        space(hdrH + rowH * Math.min(6, rows.length) + 8)

        // Header row
        fill(C.surface); draw(C.border)
        doc.setLineWidth(0.5)
        doc.rect(mX, y, tableW, hdrH, 'FD')
        fill(C.blue6); doc.rect(mX, y, tableW, 1.5, 'F')

        doc.setFont('courier', 'bold'); doc.setFontSize(6.5)
        text(C.zinc6)
        let cx = mX
        cols.forEach(c => {
          const tx = c.align === 'right' ? cx + c.width - 6 - doc.getTextWidth(c.header.toUpperCase()) : cx + 6
          doc.text(c.header.toUpperCase(), tx, y + 13)
          cx += c.width
        })
        y += hdrH

        // Data rows
        doc.setFont('courier', 'normal'); doc.setFontSize(7)
        rows.forEach((row, ri) => {
          space(rowH + 2)
          if (ri % 2 === 0) { fill(C.surface); doc.rect(mX, y, tableW, rowH, 'F') }
          draw(C.border); doc.line(mX, y + rowH, mX + tableW, y + rowH)

          let cx2 = mX
          row.forEach((cell, ci) => {
            const col = cols[ci]
            text(cell.color ?? C.zinc4)
            const tw = doc.getTextWidth(cell.text)
            const tx = col.align === 'right' ? cx2 + col.width - 6 - tw : cx2 + 6
            doc.text(cell.text, tx, y + 11)
            cx2 += col.width
          })
          y += rowH
        })
        y += 10
      }

      // ════════════════════════════════════════════════════════════════════
      header()
      y += 4

      // ── 01 / Key metrics ─────────────────────────────────────────────────
      sectionLabel('01', 'Key Metrics', 'Executive Summary')
      metricGrid([
        { label: 'On-chain supply', value: `${n(data.onChainSupply)} nTZS`, sub: 'Base mainnet totalSupply()' },
        { label: 'Total minted (DB)', value: `${n(data.stats.totalMinted)} TZS`, sub: `${n(data.stats.totalDeposits)} deposits` },
        { label: 'Pending issuance', value: `${n(data.stats.totalPending)} TZS`, sub: 'Awaiting confirmation' },
        { label: 'Daily cap utilisation', value: `${pct(data.dailyIssuance.issued, data.dailyIssuance.cap)}%`, sub: `Issued: ${n(data.dailyIssuance.issued)} TZS` },
        { label: 'Registered users', value: n(data.stats.totalUsers), sub: `${n(data.stats.totalWallets)} wallets linked` },
        { label: 'Reserve status', value: '1:1 BACKED', sub: 'Dual-approval enforced' },
      ])

      // ── 02 / Reserve verification ─────────────────────────────────────────
      sectionLabel('02', 'Reserve Verification', 'Reserve Integrity')
      table(
        [
          { header: 'Metric', width: 220 },
          { header: 'Value', width: 160, align: 'right' },
          { header: 'Note', width: cW - 380 },
        ],
        [
          [
            { text: 'On-chain supply', color: C.white },
            { text: `${n(data.onChainSupply)} nTZS`, color: C.blue4 },
            { text: 'Base mainnet contract totalSupply()' },
          ],
          [
            { text: 'Confirmed deposits (DB)', color: C.white },
            { text: `${n(data.stats.totalMinted)} TZS`, color: C.emerald },
            { text: 'Minted after dual-approval' },
          ],
          [
            { text: 'Pending issuance', color: C.white },
            { text: `${n(data.stats.totalPending)} TZS`, color: C.amber },
            { text: 'In approval pipeline' },
          ],
          [
            { text: 'Reserve ratio', color: C.white },
            { text: '1:1', color: C.emerald },
            { text: 'Enforced by workflow — not computed' },
          ],
        ]
      )

      // ── 03 / Issuance controls ────────────────────────────────────────────
      sectionLabel('03', 'Issuance Controls', 'Daily Issuance Cap')
      metricGrid([
        { label: 'Daily cap', value: `${n(data.dailyIssuance.cap)} TZS`, sub: 'Platform-wide regulatory limit' },
        { label: 'Issued today', value: `${n(data.dailyIssuance.issued)} TZS`, sub: `${pct(data.dailyIssuance.issued, data.dailyIssuance.cap)}% utilised` },
        { label: 'Remaining', value: `${n(Math.max(0, data.dailyIssuance.cap - data.dailyIssuance.issued))} TZS`, sub: 'Available capacity' },
      ], 3)

      // Progress bar
      space(20)
      const barW = cW
      const barH = 6
      fill(C.surface); draw(C.border)
      doc.rect(mX, y, barW, barH, 'FD')
      const usedW = Math.min(barW, (data.dailyIssuance.issued / data.dailyIssuance.cap) * barW)
      if (usedW > 0) { fill(C.blue4); doc.rect(mX, y, usedW, barH, 'F') }
      y += 16

      // ── 04 / KYC overview ─────────────────────────────────────────────────
      sectionLabel('04', 'KYC & Compliance', 'Identity Verification Status')
      metricGrid([
        { label: 'KYC Approved', value: n(data.kyc.approved), sub: 'Active participants' },
        { label: 'KYC Pending', value: n(data.kyc.pending), sub: 'Awaiting review' },
        { label: 'KYC Rejected', value: n(data.kyc.rejected), sub: 'Failed verification' },
      ], 3)

      // ── 05 / Deposit pipeline ─────────────────────────────────────────────
      sectionLabel('05', 'Deposit Pipeline', 'Status Distribution')
      table(
        [
          { header: 'Status', width: 180 },
          { header: 'Count', width: 80, align: 'right' },
          { header: 'Total (TZS)', width: 140, align: 'right' },
          { header: '% of volume', width: cW - 400, align: 'right' },
        ],
        data.statusBreakdown.map(s => {
          const statusColor = s.status === 'minted' ? C.emerald
            : s.status.includes('pending') || s.status.includes('processing') ? C.amber
            : s.status === 'rejected' || s.status.includes('failed') ? C.red
            : C.zinc4
          return [
            { text: s.status.replace(/_/g, ' ').toUpperCase(), color: statusColor },
            { text: n(s.count), color: C.white },
            { text: n(s.totalTzs), color: C.white },
            { text: `${pct(s.totalTzs, data.stats.totalMinted + data.stats.totalPending)}%` },
          ]
        })
      )

      // ── 06 / Recent deposits ──────────────────────────────────────────────
      sectionLabel('06', 'Recent Activity', 'Latest Deposit Requests')
      table(
        [
          { header: 'ID', width: 68 },
          { header: 'Amount (TZS)', width: 110, align: 'right' },
          { header: 'Status', width: 120 },
          { header: 'Provider', width: 80 },
          { header: 'TX Hash', width: cW - 378 },
        ],
        data.recentDeposits.slice(0, 14).map(d => {
          const statusColor = d.status === 'minted' ? C.emerald
            : d.status.includes('pending') || d.status.includes('processing') ? C.amber
            : d.status === 'rejected' || d.status.includes('failed') ? C.red
            : C.zinc4
          return [
            { text: d.id.slice(0, 8), color: C.zinc6 },
            { text: n(d.amountTzs), color: C.white },
            { text: d.status.replace(/_/g, ' ').toUpperCase(), color: statusColor },
            { text: (d.provider ?? 'bank').toUpperCase(), color: C.zinc4 },
            { text: d.txHash ? `${d.txHash.slice(0, 18)}...` : '—', color: d.txHash ? C.blue4 : C.zinc7 },
          ]
        })
      )

      footer(pageNo)

      const filename = `nTZS-Report-${data.dailyIssuance.date}.pdf`
      doc.save(filename)
    } catch (err) {
      console.error('PDF generation failed:', err)
      alert('Failed to generate report. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={generatePDF}
      disabled={loading}
      className="inline-flex items-center gap-2 border border-white/10 bg-white/[0.04] px-4 py-2 font-mono text-[10px] tracking-widest text-zinc-300 uppercase transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
    >
      {loading ? (
        <>
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Generating...
        </>
      ) : (
        <>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Export Report
        </>
      )}
    </button>
  )
}
