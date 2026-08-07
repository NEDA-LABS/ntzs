import fs from 'fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

import type { Report, Section } from './figures'
import { buildReturnDocument, renderReturnPdf, returnPdfFilename, SANDBOX_REF, type Block } from './pdf'

function report(sections: Section[]): Report {
  return {
    range: { from: new Date('2026-06-23T00:00:00Z'), to: new Date('2026-08-07T00:00:00Z') },
    sections,
    generatedAt: new Date('2026-08-07T09:00:00Z'),
  }
}

function section(over: Partial<Section>): Section {
  return { id: 's', title: 'Section', question: 'q', figures: [], ...over }
}

const text = (blocks: Block[]) => JSON.stringify(blocks)
const kinds = (blocks: Block[]) => blocks.map((b) => b.kind)

/**
 * The control that stops an unfinished return being attached to an email.
 * While any pre-filing item is outstanding the letter is stamped, unsigned,
 * and carries the outstanding list; clear them and the same button produces a
 * signable document. Nothing about this is cosmetic.
 */
describe('a return with outstanding items cannot be mistaken for a final one', () => {
  const withWarning = () =>
    buildReturnDocument(report([section({ title: 'Reserve', figures: [] })]), {
      warnings: [{ section: 'Reserve', label: 'Days attested', note: 'no attestations in this period' }],
    })

  it('stamps the draft notice and withholds the signature block', () => {
    const blocks = withWarning()
    expect(kinds(blocks)).toContain('notice')
    expect(kinds(blocks)).not.toContain('signature')
    expect(text(blocks)).toContain('DRAFT — NOT FOR ISSUE')
  })

  it('prints the outstanding items in an annex, never in the body', () => {
    const blocks = withWarning()
    const annexAt = kinds(blocks).indexOf('annexHeading')
    expect(annexAt).toBeGreaterThan(-1)
    const item = blocks.find((b) => b.kind === 'annexItem')
    expect(item && 'text' in item ? item.text : '').toContain('no attestations in this period')
    // Everything before the annex is the return itself.
    expect(kinds(blocks.slice(0, annexAt))).not.toContain('annexItem')
  })

  it('produces a signable letter with no annex once everything is cleared', () => {
    const blocks = buildReturnDocument(report([section({})]), { warnings: [] })
    expect(kinds(blocks)).toContain('signature')
    expect(kinds(blocks)).not.toContain('notice')
    expect(kinds(blocks)).not.toContain('annexHeading')
  })
})

/**
 * A warning is an instruction to us. Printing one in the body would put our
 * internal to-do list in a supervisory document — and worse, would read as a
 * disclosure we had not decided to make.
 */
describe('pre-filing warnings never reach the body', () => {
  it('keeps a figure warning out of the figure block', () => {
    const blocks = buildReturnDocument(
      report([
        section({
          title: 'Incidents',
          figures: [
            {
              label: 'Customer funds lost',
              value: 0,
              provenance: 'sum of funds_lost_tzs',
              warn: '2 incident(s) have no established figure — establish them before filing',
            },
          ],
        }),
      ]),
      { warnings: [] }
    )
    const figure = blocks.find((b) => b.kind === 'figure')
    expect(figure).toBeTruthy()
    expect(JSON.stringify(figure)).not.toContain('establish them before filing')
  })
})

/**
 * The generator's own rule, carried into print: a blank cell in a supervisory
 * return reads as nil, and a failed query is a statement about our plumbing —
 * never about the world.
 */
describe('an uncomputable figure prints as unavailable, with the reason', () => {
  const blocks = () =>
    buildReturnDocument(
      report([
        section({
          figures: [
            {
              label: 'Days attested',
              value: null,
              provenance: 'not computed',
              unavailable: 'the table this reads has not been created in this database yet',
              unit: 'days',
            },
          ],
        }),
      ]),
      { warnings: [] }
    )

  it('never prints an empty value or a zero', () => {
    const figure = blocks().find((b) => b.kind === 'figure')!
    expect(figure.kind === 'figure' && figure.value).toBe('unavailable')
  })

  it('carries the reason as the note, so the gap explains itself', () => {
    const figure = blocks().find((b) => b.kind === 'figure')!
    expect(figure.kind === 'figure' && figure.note).toContain('has not been created')
  })

  it('drops the unit, which would dress a non-answer as an answer', () => {
    const figure = blocks().find((b) => b.kind === 'figure')!
    expect(figure.kind === 'figure' && figure.unit).toBeUndefined()
  })

  it('still prints a real zero as zero', () => {
    const b = buildReturnDocument(
      report([section({ figures: [{ label: 'Refusals', value: 0, provenance: 'count(*)' }] })]),
      { warnings: [] }
    )
    const figure = b.find((x) => x.kind === 'figure')!
    expect(figure.kind === 'figure' && figure.value).toBe('0')
  })
})

describe('the letter identifies itself to the Bank', () => {
  it('carries the addressee, the sandbox reference and the period', () => {
    const blocks = buildReturnDocument(report([section({})]), { warnings: [] })
    const meta = blocks.filter((b) => b.kind === 'meta')
    const joined = JSON.stringify(meta)
    expect(joined).toContain('Bank of Tanzania')
    expect(joined).toContain(SANDBOX_REF)
    expect(joined).toContain('23 Jun 2026')
    expect(joined).toContain('7 Aug 2026')
  })

  it('numbers sections as the return reads them', () => {
    const blocks = buildReturnDocument(
      report([section({ title: 'Executive summary' }), section({ title: 'Compliance with the approved testing parameters' })]),
      { warnings: [] }
    )
    const headings = blocks.filter((b) => b.kind === 'h2').map((b) => ('text' in b ? b.text : ''))
    expect(headings[0]).toBe('1. Executive summary')
    expect(headings[1]).toBe('2. Compliance with the approved testing parameters')
  })

  it('names the attachment by period, so two returns never share a filename', () => {
    expect(returnPdfFilename(report([]))).toBe('NEDA-Labs-nTZS-BoT-Return-2026-06-23-to-2026-08-07.pdf')
  })
})

/**
 * The style is the one the Bank already holds. scripts/build-bot-merchant-
 * settlement-pdf.py renders the markdown letters; this module renders the
 * generated return. If they drift, the Bank receives two documents claiming to
 * be from the same organisation and looking like they are not.
 */
describe('the house style matches the letters already sent', () => {
  const src = fs.readFileSync(path.join(__dirname, 'pdf.ts'), 'utf8')
  const letterScript = fs.readFileSync(
    path.join(__dirname, '../../../../../scripts/build-bot-merchant-settlement-pdf.py'),
    'utf8'
  )

  it('uses the same ink, muted, rule and band colours', () => {
    for (const hex of ['#111111', '#5A5A5A', '#C9C9C9', '#F2F4F3']) {
      expect(src, `pdf.ts is missing ${hex}`).toContain(hex)
      expect(letterScript, `the letter script is missing ${hex}`).toContain(hex)
    }
  })

  it('uses the same page geometry', () => {
    // 24mm sides, 22mm top and bottom, 26mm of letterhead on page one.
    expect(src).toContain('24 * MM')
    expect(src).toContain('22 * MM')
    expect(src).toContain('26 * MM')
    expect(letterScript).toContain('24 * mm')
    expect(letterScript).toContain('22 * mm')
    expect(letterScript).toContain('26 * mm')
  })

  it('sets the same body type: serif at 10.5 on 15.5', () => {
    expect(src).toMatch(/size: 10\.5,\s*\n?\s*leading: 15\.5/)
    expect(src).toMatch(/font: 'times'/)
    expect(letterScript).toMatch(/fontSize=10\.5,\s*\n\s*leading=15\.5/)
    expect(letterScript).toContain('fontName="Times-Roman"')
  })

  it('prints the same letterhead lines and confidentiality footer', () => {
    for (const line of [
      'NEDA LABS LIMITED',
      'nTZS — Tanzanian Shilling Stablecoin',
      'Dar es Salaam, United Republic of Tanzania',
      'NEDA Labs Limited — confidential. Prepared for the Bank of Tanzania.',
    ]) {
      expect(src, `pdf.ts is missing "${line}"`).toContain(line)
      expect(letterScript, `the letter script is missing "${line}"`).toContain(line)
    }
  })
})

/**
 * Rendering is exercised end to end because the failure that matters — a
 * library that throws on a real report — cannot be caught by inspecting the
 * block model.
 */
describe('rendering produces a real document', () => {
  const full = report([
    section({
      title: 'Executive summary',
      narrative:
        'nTZS is tested here as settlement infrastructure, not as a product the public holds for its own sake — ' +
        'participants and merchants transact in Tanzanian Shillings at both ends of every flow.',
    }),
    section({
      title: 'Compliance with the approved testing parameters',
      figures: [
        { label: 'Participants (Parameter 2)', value: 47, unit: 'of 100 permitted', provenance: 'count(distinct wallets.user_id)' },
        { label: 'Days attested', value: null, provenance: 'not computed', unavailable: 'query failed' },
      ],
    }),
  ])

  it('renders a clean return without throwing, and it is a PDF', () => {
    const doc = renderReturnPdf(buildReturnDocument(full, { warnings: [] }), { logo: null })
    const out = Buffer.from(doc.output('arraybuffer'))
    expect(out.subarray(0, 5).toString()).toBe('%PDF-')
    expect(out.byteLength).toBeGreaterThan(2000)
  })

  it('renders the draft variant, and marks the footer of every page', () => {
    const warnings = [{ section: 'Parameters', label: 'Days attested', note: 'query failed' }]
    const doc = renderReturnPdf(buildReturnDocument(full, { warnings }), { logo: null, draft: true })
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1')
    expect(raw).toContain('DRAFT, not for issue')
    // The annex forces its own page, so a draft is always at least two pages.
    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
  })

  it('survives a logo that will not decode rather than losing the letter', () => {
    const doc = renderReturnPdf(buildReturnDocument(full, { warnings: [] }), { logo: 'data:image/png;base64,not-an-image' })
    expect(Buffer.from(doc.output('arraybuffer')).subarray(0, 5).toString()).toBe('%PDF-')
  })
})
