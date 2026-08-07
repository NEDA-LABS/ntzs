import { jsPDF } from 'jspdf'

import { formatDateEAT } from '@/lib/format-date'

import type { Report } from './figures'

/**
 * The periodic return as a letter, in the house style used for every
 * submission this Bank already holds.
 *
 * The style is not decoration. The Bank has received our parameter-extension
 * and notification letters in exactly this dress — same letterhead, same serif
 * body at 10.5/15.5, same rule, same confidentiality footer (scripts/
 * build-bot-merchant-settlement-pdf.py owns the same constants for the
 * markdown letters). A return that arrives looking like a different
 * organisation's document invites the question of who produced it.
 *
 * Two rules carried over from the generator, and they are the whole design:
 *
 * 1. A FIGURE THAT COULD NOT BE COMPUTED PRINTS AS "unavailable", WITH THE
 *    REASON — never blank, never zero. A blank cell in a supervisory return
 *    reads as nil; a failed query is a statement about our plumbing.
 *
 * 2. PRE-FILING WARNINGS NEVER APPEAR IN THE BODY. They are instructions to
 *    us, not disclosures to the Bank. While any remain the document is stamped
 *    DRAFT, carries no signature block, and lists the outstanding items in an
 *    internal annex. Clear them and the same button produces a signable
 *    letter. This is the one control that stops an unfinished return being
 *    attached to an email.
 */

// ── House style ───────────────────────────────────────────────────────────────
// Millimetres, because the letter template is specified in them.
const MM = 2.834645669

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN_X = 24 * MM
const MARGIN_TOP = 22 * MM
const MARGIN_BOTTOM = 22 * MM
/** Vertical space the first-page letterhead occupies before body text starts. */
const HEADER_H = 26 * MM

const CONTENT_W = PAGE_W - 2 * MARGIN_X
const CONTENT_BOTTOM = PAGE_H - MARGIN_BOTTOM

const INK = '#111111'
const MUTED = '#5A5A5A'
const RULE = '#C9C9C9'
const BAND = '#F2F4F3'

/** The Bank's own reference for this sandbox authorisation. */
export const SANDBOX_REF = 'LD.170/515/02/1254'

// ── Document model ────────────────────────────────────────────────────────────
// Built first, rendered second. Every rule above is a decision about WHICH
// blocks exist, so the rules are unit-tested without touching a PDF library.

export interface TableColumn {
  header: string
  /** Share of the content width, normalised across the columns. */
  weight: number
  align?: 'left' | 'right'
}

export interface TableCell {
  text: string
  /** Small muted second line inside the cell — a derivation or a caveat. */
  sub?: string
  bold?: boolean
}

export type Block =
  | { kind: 'title'; text: string }
  | { kind: 'meta'; label: string; value: string }
  | { kind: 'notice'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'caption'; text: string }
  | { kind: 'table'; columns: TableColumn[]; rows: TableCell[][] }
  /** Small stat cards, three to a row — the shape a supervisor scans first. */
  | { kind: 'grid'; items: Array<{ label: string; value: string; sub?: string }> }
  | { kind: 'annexHeading'; text: string }
  | { kind: 'annexItem'; text: string }
  | { kind: 'signature' }

export interface ReturnDocumentOptions {
  /** Pre-filing warnings from preFilingWarnings(report). */
  warnings: Array<{ section: string; label: string; note: string }>
  sandboxRef?: string
}

/** A figure's printed value. Never empty, never a silent zero. */
function figureValue(value: string | number | null, unavailable?: string): string {
  if (unavailable) return 'unavailable'
  if (value == null) return 'unavailable'
  return typeof value === 'number' ? value.toLocaleString() : value
}

/**
 * The panel a supervisor reads before anything else: the four questions the
 * whole return exists to answer, each lifted verbatim from the section that
 * computes it so the panel can never disagree with the body.
 *
 * A figure that is missing or uncomputed is simply absent from the panel — a
 * summary is the wrong place to introduce a caveat, and the body reports it
 * properly a page later.
 */
function atAGlance(report: Report): Array<{ label: string; value: string; sub?: string }> {
  const find = (label: string) => {
    for (const section of report.sections) {
      const figure = section.figures.find((f) => f.label === label)
      if (figure && !figure.unavailable && figure.value != null) return figure
    }
    return null
  }

  const items: Array<{ label: string; value: string; sub?: string }> = []
  const push = (label: string, from: string, sub?: (unit?: string) => string | undefined) => {
    const figure = find(from)
    if (!figure) return
    items.push({
      label,
      value: figureValue(figure.value),
      sub: sub ? sub(figure.unit) : figure.unit,
    })
  }

  push('nTZS in circulation', 'nTZS in circulation at period end', () => 'at period end, as attested')
  push('Days fully backed', 'Days fully backed', (unit) => (unit ? `${unit} attested` : undefined))
  push('Verified holders', 'Verified holders')
  push('Participants transacting', 'Participants transacting', () => 'in the period')
  push('Value issued', 'nTZS issued', () => 'TZS, minted in the period')
  push('Value redeemed', 'nTZS redeemed', () => 'TZS, burned in the period')

  return items
}

export function buildReturnDocument(report: Report, opts: ReturnDocumentOptions): Block[] {
  const isDraft = opts.warnings.length > 0
  const blocks: Block[] = []

  blocks.push({ kind: 'title', text: 'Periodic Return — Bank of Tanzania Regulatory Sandbox' })

  blocks.push({ kind: 'meta', label: 'To:', value: 'Bank of Tanzania — Regulatory Sandbox / National Payment Systems' })
  blocks.push({ kind: 'meta', label: 'From:', value: 'NEDA Labs Limited' })
  blocks.push({ kind: 'meta', label: 'Sandbox Ref:', value: opts.sandboxRef ?? SANDBOX_REF })
  blocks.push({
    kind: 'meta',
    label: 'Reporting period:',
    value: `${formatDateEAT(report.range.from)} to ${formatDateEAT(report.range.to)}`,
  })
  blocks.push({ kind: 'meta', label: 'Classification:', value: 'Regulatory — Bank of Tanzania Sandbox Submission' })

  if (isDraft) {
    blocks.push({
      kind: 'notice',
      text:
        `DRAFT — NOT FOR ISSUE. ${opts.warnings.length} item${opts.warnings.length === 1 ? '' : 's'} must be ` +
        'cleared before this return is filed; each is listed in the annex. This copy carries no signature block.',
    })
  }

  const glance = atAGlance(report)
  if (glance.length) blocks.push({ kind: 'grid', items: glance })

  report.sections.forEach((section, index) => {
    blocks.push({ kind: 'h2', text: `${index + 1}. ${section.title}` })

    if (section.narrative) blocks.push({ kind: 'para', text: section.narrative })

    if (section.figures.length) {
      blocks.push({
        kind: 'table',
        columns: [
          { header: 'Figure', weight: 0.66 },
          { header: 'Reported', weight: 0.34, align: 'right' },
        ],
        rows: section.figures.map((figure) => {
          // The reason a figure is missing is itself reportable, so it joins
          // the derivation. Warnings never appear — they are ours, not the
          // Bank's.
          const sub = [figure.unavailable ?? figure.note, `Basis: ${figure.provenance}`]
            .filter(Boolean)
            .join('\n')
          return [
            { text: figure.label, sub },
            {
              text: figureValue(figure.value, figure.unavailable),
              // A unit qualifies a real value; on an unavailable figure it
              // would dress a non-answer as an answer.
              sub: figure.unavailable ? undefined : figure.unit,
              bold: true,
            },
          ]
        }),
      })
    }

    if (section.table) {
      blocks.push({
        kind: 'table',
        columns: section.table.columns,
        rows: section.table.rows.map((row) => row.map((cell) => ({ text: cell.text, sub: cell.sub }))),
      })
      if (section.table.caption) blocks.push({ kind: 'caption', text: section.table.caption })
    }
  })

  if (isDraft) {
    blocks.push({ kind: 'annexHeading', text: 'Annex — items to clear before this return is filed' })
    blocks.push({
      kind: 'para',
      text:
        'Internal working list, printed because this copy is a draft. It is not part of the return: ' +
        'clearing every item removes this annex and produces a signable letter.',
    })
    for (const w of opts.warnings) {
      blocks.push({ kind: 'annexItem', text: `${w.section} — ${w.label}: ${w.note}` })
    }
  } else {
    blocks.push({ kind: 'signature' })
  }

  return blocks
}

// ── Renderer ──────────────────────────────────────────────────────────────────

/**
 * WinAnsi covers the typography the narratives use (em dash, curly quotes),
 * but a character outside it renders as a wrong glyph rather than failing
 * loudly — the worst outcome in a document nobody proofreads twice. Anything
 * unmapped is folded to its nearest ASCII form.
 */
function ascii(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–]/g, '-')
    .replace(/[—]/g, '—')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[•]/g, '•')
}

interface RenderState {
  doc: jsPDF
  y: number
  page: number
  footerNote: string
}

function footer(state: RenderState) {
  const { doc } = state
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.8)
  doc.setTextColor(MUTED)
  const baseline = PAGE_H - (MARGIN_BOTTOM - 8 * MM)
  doc.text(state.footerNote, MARGIN_X, baseline)
  const page = `Page ${state.page}`
  doc.text(page, PAGE_W - MARGIN_X - doc.getTextWidth(page), baseline)
}

function letterhead(state: RenderState, logo: string | null) {
  const { doc } = state
  let textX = MARGIN_X

  if (logo) {
    const size = 15 * MM
    try {
      doc.addImage(logo, 'PNG', MARGIN_X, 20 * MM, size, size)
      textX = MARGIN_X + size + 6 * MM
    } catch {
      // A logo that will not decode must not cost us the letterhead.
      textX = MARGIN_X
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(INK)
  doc.text('NEDA LABS LIMITED', textX, 26 * MM)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(MUTED)
  doc.text('nTZS — Tanzanian Shilling Stablecoin', textX, 30.6 * MM)
  doc.text('Dar es Salaam, United Republic of Tanzania', textX, 34.4 * MM)

  doc.setDrawColor(RULE)
  doc.setLineWidth(0.8)
  doc.line(MARGIN_X, 39.5 * MM, PAGE_W - MARGIN_X, 39.5 * MM)
}

function newPage(state: RenderState) {
  footer(state)
  state.doc.addPage()
  state.page += 1
  state.y = MARGIN_TOP
}

/** Break to a new page when the next block would not fit whole. */
function ensure(state: RenderState, needed: number) {
  if (state.y + needed > CONTENT_BOTTOM) newPage(state)
}

function paragraph(
  state: RenderState,
  text: string,
  opts: { font: 'times' | 'helvetica'; style: 'normal' | 'bold' | 'italic'; size: number; leading: number; color: string; indent?: number; justify?: boolean }
) {
  const { doc } = state
  doc.setFont(opts.font, opts.style)
  doc.setFontSize(opts.size)
  doc.setTextColor(opts.color)

  const x = MARGIN_X + (opts.indent ?? 0)
  const width = CONTENT_W - (opts.indent ?? 0)
  const lines = doc.splitTextToSize(ascii(text), width) as string[]

  for (let i = 0; i < lines.length; i++) {
    ensure(state, opts.leading)
    // Justify every line but the last — a justified final line stretches a few
    // words across the measure and looks like a fault.
    const justify = opts.justify && i < lines.length - 1 && lines.length > 1
    doc.setFont(opts.font, opts.style)
    doc.setFontSize(opts.size)
    doc.setTextColor(opts.color)
    if (justify) {
      doc.text(lines[i], x, state.y, { maxWidth: width, align: 'justify' })
    } else {
      doc.text(lines[i], x, state.y)
    }
    state.y += opts.leading
  }
}

function renderBlock(state: RenderState, block: Block) {
  const { doc } = state

  switch (block.kind) {
    case 'title':
      ensure(state, 40)
      state.y += 6
      paragraph(state, block.text, { font: 'helvetica', style: 'bold', size: 13, leading: 17, color: INK })
      state.y += 6
      break

    case 'meta': {
      ensure(state, 16)
      doc.setFont('times', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(INK)
      const labelW = doc.getTextWidth(block.label) + 4
      doc.text(ascii(block.label), MARGIN_X, state.y)
      doc.setFont('times', 'normal')
      const lines = doc.splitTextToSize(ascii(block.value), CONTENT_W - labelW) as string[]
      lines.forEach((line, i) => {
        if (i > 0) {
          state.y += 14
          ensure(state, 14)
        }
        doc.setFont('times', 'normal')
        doc.setFontSize(9.5)
        doc.setTextColor(INK)
        doc.text(line, MARGIN_X + labelW, state.y)
      })
      state.y += 14
      break
    }

    case 'notice': {
      const inner = CONTENT_W - 16
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      const lines = doc.splitTextToSize(ascii(block.text), inner) as string[]
      const boxH = lines.length * 12 + 14
      ensure(state, boxH + 12)
      state.y += 6
      doc.setFillColor(BAND)
      doc.setDrawColor(RULE)
      doc.setLineWidth(0.6)
      doc.rect(MARGIN_X, state.y, CONTENT_W, boxH, 'FD')
      doc.setTextColor(INK)
      lines.forEach((line, i) => {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        doc.setTextColor(INK)
        doc.text(line, MARGIN_X + 8, state.y + 16 + i * 12)
      })
      state.y += boxH + 12
      break
    }

    case 'h2':
      ensure(state, 34)
      state.y += 13
      paragraph(state, block.text, { font: 'helvetica', style: 'bold', size: 10.5, leading: 14, color: INK })
      state.y += 5
      break

    case 'para':
      paragraph(state, block.text, {
        font: 'times',
        style: 'normal',
        size: 10.5,
        leading: 15.5,
        color: INK,
        justify: true,
      })
      state.y += 7
      break

    case 'caption':
      paragraph(state, block.text, {
        font: 'times',
        style: 'italic',
        size: 8.5,
        leading: 11.5,
        color: MUTED,
      })
      state.y += 8
      break

    case 'grid': {
      const cols = 3
      const gap = 8
      const cardW = (CONTENT_W - gap * (cols - 1)) / cols
      const rows = Math.ceil(block.items.length / cols)
      const cardH = 46
      ensure(state, rows * (cardH + gap) + 8)
      state.y += 2

      block.items.forEach((item, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = MARGIN_X + col * (cardW + gap)
        const yy = state.y + row * (cardH + gap)

        doc.setFillColor(BAND)
        doc.setDrawColor(RULE)
        doc.setLineWidth(0.5)
        doc.rect(x, yy, cardW, cardH, 'FD')

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.6)
        doc.setTextColor(MUTED)
        doc.text(ascii(item.label.toUpperCase()), x + 8, yy + 13)

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(13)
        doc.setTextColor(INK)
        // Long figures must shrink rather than run past the card edge.
        let size = 13
        while (size > 8 && doc.getTextWidth(ascii(item.value)) > cardW - 16) {
          size -= 0.5
          doc.setFontSize(size)
        }
        doc.text(ascii(item.value), x + 8, yy + 30)

        if (item.sub) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(6.4)
          doc.setTextColor(MUTED)
          const sub = doc.splitTextToSize(ascii(item.sub), cardW - 16) as string[]
          doc.text(sub[0], x + 8, yy + 40)
        }
      })

      state.y += rows * (cardH + gap) + 10
      break
    }

    case 'table': {
      const total = block.columns.reduce((sum, c) => sum + c.weight, 0) || 1
      const widths = block.columns.map((c) => (c.weight / total) * CONTENT_W)
      const PAD = 6

      const drawHeader = () => {
        const h = 19
        ensure(state, h + 24)
        doc.setFillColor(BAND)
        doc.setDrawColor(RULE)
        doc.setLineWidth(0.6)
        doc.rect(MARGIN_X, state.y, CONTENT_W, h, 'FD')

        let x = MARGIN_X
        block.columns.forEach((c, i) => {
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(7)
          doc.setTextColor(INK)
          const label = ascii(c.header)
          const tx = c.align === 'right' ? x + widths[i] - PAD - doc.getTextWidth(label) : x + PAD
          doc.text(label, tx, state.y + 13)
          x += widths[i]
        })
        state.y += h
      }

      drawHeader()

      for (const row of block.rows) {
        // Measure the row whole before committing to it, so a cell never lands
        // on a different page from the figure it belongs to.
        let height = 0
        const cellLines: Array<{ main: string[]; sub: string[] }> = row.map((cell, i) => {
          const w = widths[i] - PAD * 2
          doc.setFont('times', cell.bold ? 'bold' : 'normal')
          doc.setFontSize(9.4)
          const main = doc.splitTextToSize(ascii(cell.text), w) as string[]
          doc.setFont('times', 'italic')
          doc.setFontSize(8)
          const sub = cell.sub
            ? (cell.sub
                .split('\n')
                .flatMap((line) => doc.splitTextToSize(ascii(line), w) as string[]) as string[])
            : []
          height = Math.max(height, main.length * 12 + sub.length * 10)
          return { main, sub }
        })
        height += 10

        if (state.y + height > CONTENT_BOTTOM) {
          newPage(state)
          drawHeader()
        }

        let x = MARGIN_X
        row.forEach((cell, i) => {
          const { main, sub } = cellLines[i]
          let ty = state.y + 12
          main.forEach((line) => {
            doc.setFont('times', cell.bold ? 'bold' : 'normal')
            doc.setFontSize(9.4)
            doc.setTextColor(INK)
            const tx =
              block.columns[i].align === 'right'
                ? x + widths[i] - PAD - doc.getTextWidth(line)
                : x + PAD
            doc.text(line, tx, ty)
            ty += 12
          })
          sub.forEach((line) => {
            doc.setFont('times', 'italic')
            doc.setFontSize(8)
            doc.setTextColor(MUTED)
            const tx =
              block.columns[i].align === 'right'
                ? x + widths[i] - PAD - doc.getTextWidth(line)
                : x + PAD
            doc.text(line, tx, ty)
            ty += 10
          })
          x += widths[i]
        })

        state.y += height
        doc.setDrawColor(RULE)
        doc.setLineWidth(0.25)
        doc.line(MARGIN_X, state.y, PAGE_W - MARGIN_X, state.y)
      }

      // Close the body with the same weight as the header, so the table reads
      // as one object rather than a run of rules.
      doc.setDrawColor(RULE)
      doc.setLineWidth(0.6)
      doc.line(MARGIN_X, state.y, PAGE_W - MARGIN_X, state.y)
      state.y += 12
      break
    }

    case 'annexHeading':
      newPage(state)
      paragraph(state, block.text, { font: 'helvetica', style: 'bold', size: 13, leading: 17, color: INK })
      state.y += 8
      break

    case 'annexItem':
      paragraph(state, `•  ${block.text}`, {
        font: 'times',
        style: 'normal',
        size: 9.5,
        leading: 13,
        color: INK,
        indent: 6,
      })
      state.y += 3
      break

    case 'signature': {
      ensure(state, 130)
      state.y += 18
      paragraph(state, 'Signed for NEDA Labs Limited', {
        font: 'helvetica',
        style: 'bold',
        size: 10.5,
        leading: 14,
        color: INK,
      })
      state.y += 10
      for (const field of ['Name', 'Position', 'Signature', 'Date']) {
        ensure(state, 26)
        doc.setFont('times', 'normal')
        doc.setFontSize(10)
        doc.setTextColor(INK)
        doc.text(field, MARGIN_X, state.y)
        doc.setDrawColor(RULE)
        doc.setLineWidth(0.5)
        doc.line(MARGIN_X + 80, state.y + 2, MARGIN_X + 300, state.y + 2)
        state.y += 26
      }
      break
    }
  }
}

export interface RenderOptions {
  /** PNG data URI for the letterhead mark, or null to render text-only. */
  logo?: string | null
  /** Marked in the footer of every page while items remain outstanding. */
  draft?: boolean
}

export function renderReturnPdf(blocks: Block[], opts: RenderOptions = {}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.setProperties({
    title: 'Periodic Return — Bank of Tanzania Regulatory Sandbox',
    author: 'NEDA Labs Limited',
    subject: `Bank of Tanzania Regulatory Sandbox ${SANDBOX_REF}`,
  })

  const state: RenderState = {
    doc,
    y: MARGIN_TOP + HEADER_H,
    page: 1,
    footerNote: opts.draft
      ? 'NEDA Labs Limited — confidential. DRAFT, not for issue.'
      : 'NEDA Labs Limited — confidential. Prepared for the Bank of Tanzania.',
  }

  letterhead(state, opts.logo ?? null)
  for (const block of blocks) renderBlock(state, block)
  footer(state)

  return doc
}

/** Filename for the emailed attachment. */
export function returnPdfFilename(report: Report): string {
  const iso = (d: Date) => new Date(d).toISOString().slice(0, 10)
  return `NEDA-Labs-nTZS-BoT-Return-${iso(report.range.from)}-to-${iso(report.range.to)}.pdf`
}
