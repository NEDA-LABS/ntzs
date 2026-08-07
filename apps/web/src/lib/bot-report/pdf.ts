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

export type Block =
  | { kind: 'title'; text: string }
  | { kind: 'meta'; label: string; value: string }
  | { kind: 'notice'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'para'; text: string }
  | {
      kind: 'figure'
      label: string
      value: string
      unit?: string
      note?: string
      basis: string
    }
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

  report.sections.forEach((section, index) => {
    blocks.push({ kind: 'h2', text: `${index + 1}. ${section.title}` })

    if (section.narrative) blocks.push({ kind: 'para', text: section.narrative })

    for (const figure of section.figures) {
      blocks.push({
        kind: 'figure',
        label: figure.label,
        value: figureValue(figure.value, figure.unavailable),
        // The unit qualifies a real value; on an unavailable figure it would
        // dress a non-answer as an answer.
        unit: figure.unavailable ? undefined : figure.unit,
        // The reason a figure is missing is itself reportable, so it takes the
        // note line. Warnings never appear here — they are ours, not the Bank's.
        note: figure.unavailable ?? figure.note,
        basis: figure.provenance,
      })
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

    case 'figure': {
      // Keep the label, its value and at least the first basis line together;
      // a figure split from its number is worse than a page with a short foot.
      ensure(state, 34)

      doc.setFont('times', 'bold')
      doc.setFontSize(10.5)
      doc.setTextColor(INK)
      const valueText = ascii(block.value)
      const valueW = doc.getTextWidth(valueText)

      doc.setFont('times', 'normal')
      doc.setFontSize(10.5)
      const labelLines = doc.splitTextToSize(ascii(block.label), CONTENT_W - valueW - 18) as string[]
      labelLines.forEach((line, i) => {
        doc.setFont('times', 'normal')
        doc.setFontSize(10.5)
        doc.setTextColor(INK)
        doc.text(line, MARGIN_X, state.y + i * 13)
      })

      doc.setFont('times', 'bold')
      doc.setFontSize(10.5)
      doc.setTextColor(INK)
      doc.text(valueText, PAGE_W - MARGIN_X - valueW, state.y)

      state.y += labelLines.length * 13

      if (block.unit) {
        doc.setFont('times', 'normal')
        doc.setFontSize(8.5)
        doc.setTextColor(MUTED)
        const unitText = ascii(block.unit)
        const w = doc.getTextWidth(unitText)
        // A long unit string is a breakdown, not a suffix — wrap it left.
        if (w > CONTENT_W * 0.55) {
          const lines = doc.splitTextToSize(unitText, CONTENT_W - 10) as string[]
          lines.forEach((line) => {
            ensure(state, 11)
            doc.setFont('times', 'normal')
            doc.setFontSize(8.5)
            doc.setTextColor(MUTED)
            doc.text(line, MARGIN_X + 10, state.y)
            state.y += 11
          })
        } else {
          doc.text(unitText, PAGE_W - MARGIN_X - w, state.y)
          state.y += 11
        }
      }

      if (block.note) {
        paragraph(state, block.note, {
          font: 'times',
          style: 'normal',
          size: 9.2,
          leading: 12.4,
          color: INK,
          indent: 10,
        })
      }

      paragraph(state, `Basis: ${block.basis}`, {
        font: 'times',
        style: 'italic',
        size: 8.5,
        leading: 11.5,
        color: MUTED,
        indent: 10,
      })

      state.y += 3
      doc.setDrawColor(RULE)
      doc.setLineWidth(0.25)
      doc.line(MARGIN_X, state.y, PAGE_W - MARGIN_X, state.y)
      state.y += 9
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
