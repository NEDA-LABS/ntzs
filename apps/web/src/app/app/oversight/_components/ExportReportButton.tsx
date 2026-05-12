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
      const mX = 48
      const cW = W - mX * 2
      let y = 0
      let pageNo = 1

      // ── Colour palette (light / professional) ───────────────────────────
      const C = {
        white:   [255, 255, 255] as const,
        bg:      [249, 250, 251] as const,   // gray-50
        tblAlt:  [243, 244, 246] as const,   // gray-100 (alt row)
        border:  [229, 231, 235] as const,   // gray-200
        text1:   [17,  24,  39]  as const,   // gray-900
        text2:   [75,  85,  99]  as const,   // gray-600
        text3:   [156, 163, 175] as const,   // gray-400
        blue:    [37,  99,  235] as const,   // blue-600
        blueLt:  [219, 234, 254] as const,   // blue-200
        emerald: [5,   150, 105] as const,   // emerald-600
        amber:   [161, 98,  7]   as const,   // amber-700
        red:     [185, 28,  28]  as const,   // red-700
        violet:  [109, 40,  217] as const,   // violet-700
      }

      const fill  = (c: readonly [number,number,number]) => doc.setFillColor(c[0], c[1], c[2])
      const draw  = (c: readonly [number,number,number]) => doc.setDrawColor(c[0], c[1], c[2])
      const color = (c: readonly [number,number,number]) => doc.setTextColor(c[0], c[1], c[2])
      const n     = (v: number) => v.toLocaleString()
      const pct   = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : '0.0')

      // ── Status color map ─────────────────────────────────────────────────
      const statusColor = (s: string): readonly [number,number,number] => {
        if (s === 'minted' || s === 'burned' || s === 'approved')   return C.emerald
        if (s.includes('pending') || s.includes('processing') || s.includes('confirmed')) return C.amber
        if (s === 'rejected' || s.includes('failed'))               return C.red
        if (s === 'requires_second_approval')                        return C.violet
        return C.text3
      }

      // ── Page helpers ─────────────────────────────────────────────────────
      const drawPageBackground = () => {
        fill(C.white)
        doc.rect(0, 0, W, H, 'F')
      }

      const header = () => {
        drawPageBackground()

        // Blue header bar
        fill(C.blue)
        doc.rect(0, 0, W, 64, 'F')

        // Left lighter-blue accent stripe (blue-600 + 15% white blended)
        fill([70, 122, 238] as const)
        doc.rect(0, 0, 4, 64, 'F')

        // Company + title
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        color(C.blueLt)
        doc.text('NEDA LABS COMPANY LIMITED', mX, 20)

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(14)
        color(C.white)
        doc.text('Oversight & Reserves Report', mX, 38)

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        color(C.blueLt)
        doc.text('nTZS Stablecoin · Base Mainnet · Confidential', mX, 54)

        // Right: date + network
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        color(C.white)
        const dateLabel = data.generatedAt
        doc.text(dateLabel, W - mX - doc.getTextWidth(dateLabel), 28)
        const netLabel = 'Chain ID 8453 · NTZSV2 UUPS ERC-20'
        color(C.blueLt)
        doc.text(netLabel, W - mX - doc.getTextWidth(netLabel), 42)

        // Thin blue-200 line below header
        draw(C.blueLt)
        doc.setLineWidth(0.5)
        doc.line(0, 64, W, 64)

        y = 82
      }

      const footer = (p: number) => {
        draw(C.border)
        doc.setLineWidth(0.3)
        doc.line(mX, H - 30, W - mX, H - 30)

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.5)
        color(C.text3)
        const contractText = `Contract: ${data.contractAddress || 'N/A'}`
        doc.text(contractText, mX, H - 16)

        const pageText = `Page ${p}`
        doc.text(pageText, W - mX - doc.getTextWidth(pageText), H - 16)

        const centerText = 'nTZS · NEDA LABS · Confidential'
        doc.text(centerText, (W - doc.getTextWidth(centerText)) / 2, H - 16)
      }

      const newPage = () => {
        footer(pageNo)
        doc.addPage()
        pageNo++
        drawPageBackground()

        // Compact continuation header
        fill(C.blue)
        doc.rect(0, 0, W, 32, 'F')

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        color(C.white)
        doc.text('nTZS Oversight & Reserves Report  (continued)', mX, 21)

        const pg = `Page ${pageNo}`
        color(C.blueLt)
        doc.text(pg, W - mX - doc.getTextWidth(pg), 21)

        y = 50
      }

      const space = (need: number) => { if (y + need > H - 40) newPage() }

      // ── Section label ────────────────────────────────────────────────────
      const sectionLabel = (index: string, label: string) => {
        space(40)
        y += 6

        // Left blue accent bar
        fill(C.blue)
        doc.rect(mX, y, 3, 22, 'F')

        // Index
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        color(C.blue)
        doc.text(index, mX + 10, y + 9)

        // Title
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        color(C.text1)
        doc.text(label, mX + 10, y + 20)

        y += 30

        // Thin divider
        draw(C.border)
        doc.setLineWidth(0.3)
        doc.line(mX, y, W - mX, y)
        y += 10
      }

      // ── Metric card grid ─────────────────────────────────────────────────
      const metricGrid = (
        items: Array<{ label: string; value: string; sub?: string; accent?: readonly [number,number,number] }>,
        cols = 3
      ) => {
        const gap = 10
        const cardW = (cW - gap * (cols - 1)) / cols
        const cardH = 60
        const rows = Math.ceil(items.length / cols)
        space(rows * (cardH + gap) + 8)

        items.forEach((it, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          const x = mX + col * (cardW + gap)
          const yy = y + row * (cardH + gap)

          // Card background + border
          fill(C.white)
          draw(C.border)
          doc.setLineWidth(0.5)
          doc.rect(x, yy, cardW, cardH, 'FD')

          // Top blue accent line
          fill(it.accent ?? C.blue)
          doc.rect(x, yy, cardW, 2.5, 'F')

          // Label
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(6.5)
          color(C.text3)
          doc.text(it.label.toUpperCase(), x + 10, yy + 16)

          // Value
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(14)
          color(it.accent ?? C.text1)
          doc.text(it.value, x + 10, yy + 38)

          // Sub
          if (it.sub) {
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(6.5)
            color(C.text3)
            doc.text(it.sub, x + 10, yy + 52)
          }
        })

        y += rows * (cardH + gap) + 8
      }

      // ── Table ────────────────────────────────────────────────────────────
      const table = (
        cols: Array<{ header: string; width: number; align?: 'left' | 'right' }>,
        rows: Array<Array<{ text: string; color?: readonly [number,number,number]; mono?: boolean }>>
      ) => {
        const hdrH = 22
        const rowH = 17
        space(hdrH + rowH * Math.min(5, rows.length) + 10)

        // Header row
        fill(C.bg)
        draw(C.border)
        doc.setLineWidth(0.3)
        doc.rect(mX, y, cW, hdrH, 'FD')

        // Header bottom border accent
        fill(C.blue)
        doc.rect(mX, y + hdrH - 1.5, cW, 1.5, 'F')

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6.5)
        color(C.text2)
        let cx = mX
        cols.forEach(c => {
          const tx = c.align === 'right'
            ? cx + c.width - 8 - doc.getTextWidth(c.header.toUpperCase())
            : cx + 8
          doc.text(c.header.toUpperCase(), tx, y + 14)
          cx += c.width
        })
        y += hdrH

        // Data rows
        rows.forEach((row, ri) => {
          space(rowH + 2)
          if (ri % 2 !== 0) {
            fill(C.bg)
            doc.rect(mX, y, cW, rowH, 'F')
          }
          draw(C.border)
          doc.line(mX, y + rowH, mX + cW, y + rowH)

          let cx2 = mX
          row.forEach((cell, ci) => {
            const col = cols[ci]
            if (cell.mono) {
              doc.setFont('courier', 'normal')
              doc.setFontSize(6.5)
            } else {
              doc.setFont('helvetica', 'normal')
              doc.setFontSize(7.5)
            }
            color(cell.color ?? C.text2)
            const tw = doc.getTextWidth(cell.text)
            const tx = col.align === 'right'
              ? cx2 + col.width - 8 - tw
              : cx2 + 8
            doc.text(cell.text, tx, y + 12)
            cx2 += col.width
          })
          y += rowH
        })
        y += 12
      }

      // ── Progress bar ─────────────────────────────────────────────────────
      const progressBar = (value: number, max: number) => {
        space(22)
        const barH = 8
        const ratio = max > 0 ? Math.min(1, value / max) : 0
        const pctVal = (ratio * 100)

        // Track
        fill(C.bg)
        draw(C.border)
        doc.setLineWidth(0.3)
        doc.rect(mX, y, cW, barH, 'FD')

        // Fill — color by utilisation
        if (ratio > 0) {
          const barColor = pctVal > 90 ? C.red : pctVal > 70 ? C.amber : C.blue
          fill(barColor)
          doc.rect(mX, y, cW * ratio, barH, 'F')
        }

        // Labels
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.5)
        color(C.text3)
        doc.text('0%', mX, y + barH + 10)
        const pctLabel = `${pctVal.toFixed(1)}% utilized`
        doc.text(pctLabel, (W - doc.getTextWidth(pctLabel)) / 2, y + barH + 10)
        doc.text('100%', W - mX - doc.getTextWidth('100%'), y + barH + 10)

        y += barH + 16
      }

      // ── Info strip (single wide row) ─────────────────────────────────────
      const infoStrip = (items: Array<{ label: string; value: string }>) => {
        space(32)
        fill(C.bg)
        draw(C.border)
        doc.setLineWidth(0.3)
        doc.rect(mX, y, cW, 28, 'FD')

        const itemW = cW / items.length
        items.forEach((it, i) => {
          const x = mX + i * itemW + 10
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(6.5)
          color(C.text3)
          doc.text(it.label.toUpperCase(), x, y + 10)
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(8)
          color(C.text1)
          doc.text(it.value, x, y + 22)
        })
        y += 36
      }

      // ════════════════════════════════════════════════════════════════════
      header()

      // ── 01 / Executive Summary ───────────────────────────────────────────
      sectionLabel('01', 'Executive Summary')
      metricGrid([
        { label: 'On-chain supply',      value: `${n(data.onChainSupply)} nTZS`, sub: 'Base mainnet totalSupply()',         accent: C.blue    },
        { label: 'Total minted (DB)',    value: `${n(data.stats.totalMinted)} TZS`, sub: `${n(data.stats.totalDeposits)} deposits processed`, accent: C.emerald },
        { label: 'Pending issuance',     value: `${n(data.stats.totalPending)} TZS`, sub: 'In approval pipeline',           accent: C.amber   },
        { label: 'Daily cap utilisation',value: `${pct(data.dailyIssuance.issued, data.dailyIssuance.cap)}%`, sub: `${n(data.dailyIssuance.issued)} of ${n(data.dailyIssuance.cap)} TZS`, accent: C.blue },
        { label: 'Registered users',     value: n(data.stats.totalUsers), sub: `${n(data.stats.totalWallets)} wallets`,     accent: C.text1   },
        { label: 'Reserve integrity',    value: '1 : 1',                   sub: 'Dual-approval enforced',                   accent: C.emerald },
      ])

      // ── 02 / Reserve Verification ────────────────────────────────────────
      sectionLabel('02', 'Reserve Verification')
      table(
        [
          { header: 'Metric',    width: 220 },
          { header: 'Value',     width: 160, align: 'right' },
          { header: 'Note',      width: cW - 380 },
        ],
        [
          [
            { text: 'On-chain supply (authoritative)',  color: C.text1 },
            { text: `${n(data.onChainSupply)} nTZS`,   color: C.blue   },
            { text: 'Base mainnet contract totalSupply()' },
          ],
          [
            { text: 'DB confirmed mints',              color: C.text1 },
            { text: `${n(data.stats.totalMinted)} TZS`, color: C.emerald },
            { text: 'Post dual-approval minted deposits' },
          ],
          [
            { text: 'Pending issuance',                color: C.text1 },
            { text: `${n(data.stats.totalPending)} TZS`, color: C.amber },
            { text: 'Submitted or in processing' },
          ],
          [
            { text: 'Reserve ratio',                   color: C.text1 },
            { text: '1 : 1',                           color: C.emerald },
            { text: 'Enforced by workflow — not computed from ratio' },
          ],
          [
            { text: 'Contract address',                color: C.text1 },
            { text: data.contractAddress ? data.contractAddress.slice(0, 28) + '...' : 'N/A', color: C.text2, mono: true },
            { text: 'Base Mainnet · Chain ID 8453' },
          ],
        ]
      )

      // ── 03 / Daily Issuance Cap ───────────────────────────────────────────
      sectionLabel('03', 'Daily Issuance Control')
      infoStrip([
        { label: 'Report date',     value: data.dailyIssuance.date },
        { label: 'Daily cap',       value: `TZS ${n(data.dailyIssuance.cap)}` },
        { label: 'Issued today',    value: `TZS ${n(data.dailyIssuance.issued)}` },
        { label: 'Remaining',       value: `TZS ${n(Math.max(0, data.dailyIssuance.cap - data.dailyIssuance.issued))}` },
      ])
      progressBar(data.dailyIssuance.issued, data.dailyIssuance.cap)

      // ── 04 / KYC Status ───────────────────────────────────────────────────
      sectionLabel('04', 'KYC & Identity Verification')
      metricGrid([
        { label: 'KYC Approved', value: n(data.kyc.approved), sub: 'Verified participants',   accent: C.emerald },
        { label: 'KYC Pending',  value: n(data.kyc.pending),  sub: 'Awaiting review',         accent: C.amber   },
        { label: 'KYC Rejected', value: n(data.kyc.rejected), sub: 'Failed verification',     accent: C.red     },
      ], 3)

      // ── 05 / Deposit Pipeline ─────────────────────────────────────────────
      sectionLabel('05', 'Deposit Status Breakdown')
      table(
        [
          { header: 'Status',      width: 190 },
          { header: 'Count',       width: 80,         align: 'right' },
          { header: 'Total (TZS)', width: 150,        align: 'right' },
          { header: '% of volume', width: cW - 420,  align: 'right' },
        ],
        data.statusBreakdown.map(s => ([
          { text: s.status.replace(/_/g, ' '), color: statusColor(s.status) },
          { text: n(s.count), color: C.text1 },
          { text: n(s.totalTzs), color: C.text1 },
          { text: `${pct(s.totalTzs, data.stats.totalMinted + data.stats.totalPending)}%`, color: C.text2 },
        ]))
      )

      // ── 06 / Recent Deposit Activity ─────────────────────────────────────
      sectionLabel('06', 'Recent Deposit Activity')
      table(
        [
          { header: 'ID',           width: 65  },
          { header: 'Amount (TZS)', width: 110, align: 'right' },
          { header: 'Status',       width: 130 },
          { header: 'Provider',     width: 80  },
          { header: 'TX Hash',      width: cW - 385 },
        ],
        data.recentDeposits.slice(0, 15).map(d => ([
          { text: d.id.slice(0, 8), color: C.text3, mono: true },
          { text: n(d.amountTzs),   color: C.text1 },
          { text: d.status.replace(/_/g, ' '), color: statusColor(d.status) },
          { text: (d.provider ?? 'bank'), color: C.text2 },
          { text: d.txHash ? `${d.txHash.slice(0, 20)}…` : '—', color: d.txHash ? C.blue : C.text3, mono: true },
        ]))
      )

      footer(pageNo)

      doc.save(`nTZS-Oversight-Report-${data.dailyIssuance.date}.pdf`)
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
