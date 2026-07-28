const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
} = require('docx')
const fs = require('fs')

const USABLE = 9026 // A4 (11906) less 1" margins each side
const NAVY = '1F3A5F'
const GREY = '595959'
const RULE = { style: BorderStyle.SINGLE, size: 6, color: 'D0D0D0' }
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }

const p = (text, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 140, line: 276 },
    alignment: opts.align,
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, size: opts.size ?? 21, color: opts.color, font: 'Calibri' })],
  })

/** Paragraph with mixed bold/regular runs. */
const rich = (parts, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 140, line: 276 },
    children: parts.map((x) =>
      typeof x === 'string'
        ? new TextRun({ text: x, size: 21, font: 'Calibri' })
        : new TextRun({ text: x.t, bold: x.b, italics: x.i, size: 21, font: 'Calibri' })
    ),
  })

const h = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 140 },
    children: [new TextRun({ text, bold: true, size: 23, color: NAVY, font: 'Calibri' })],
  })

const bullet = (text) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 90, line: 276 },
    children: [new TextRun({ text, size: 21, font: 'Calibri' })],
  })

const numbered = (n, parts) =>
  new Paragraph({
    spacing: { after: 110, line: 276 },
    indent: { left: 360, hanging: 360 },
    children: [
      new TextRun({ text: `${n}.  `, bold: true, size: 21, font: 'Calibri' }),
      ...parts.map((x) =>
        typeof x === 'string'
          ? new TextRun({ text: x, size: 21, font: 'Calibri' })
          : new TextRun({ text: x.t, bold: x.b, size: 21, font: 'Calibri' })
      ),
    ],
  })

function cell(text, { widths, bold, header, align, shade } = {}) {
  return new TableCell({
    width: { size: widths, type: WidthType.DXA },
    shading: shade ? { type: ShadingType.CLEAR, fill: shade, color: 'auto' } : undefined,
    margins: { top: 90, bottom: 90, left: 140, right: 140 },
    children: [
      new Paragraph({
        alignment: align,
        spacing: { after: 0, line: 260 },
        children: [
          new TextRun({
            text,
            bold: bold || header,
            size: 20,
            color: header ? 'FFFFFF' : undefined,
            font: 'Calibri',
          }),
        ],
      }),
    ],
  })
}

function table(columnWidths, headerRow, bodyRows) {
  return new Table({
    columnWidths,
    width: { size: USABLE, type: WidthType.DXA },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headerRow.map((t, i) => cell(t, { widths: columnWidths[i], header: true, shade: NAVY })),
      }),
      ...bodyRows.map((r, ri) =>
        new TableRow({
          children: r.map((t, i) =>
            cell(t, {
              widths: columnWidths[i],
              bold: i === 0,
              shade: ri % 2 === 1 ? 'F4F6F8' : undefined,
              align: i > 0 && /^[\d,]+( TZS)?$|^Unchanged$/.test(t) ? AlignmentType.RIGHT : undefined,
            })
          ),
        })
      ),
    ],
  })
}

const spacer = (after = 200) => new Paragraph({ spacing: { after }, children: [] })

const doc = new Document({
  creator: 'NEDA Labs Limited',
  title: 'Request for a Variation to Testing Parameters — Agent Participant Class',
  description: 'Regulatory submission to the Bank of Tanzania',
  sections: [
    {
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children: [
        // ── Letterhead ────────────────────────────────────────────────────
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: 'NEDA LABS LIMITED', bold: true, size: 26, color: NAVY, font: 'Calibri' })],
        }),
        new Paragraph({
          spacing: { after: 200 },
          border: { bottom: RULE },
          children: [
            new TextRun({ text: 'Issuer of nTZS · Bank of Tanzania Regulatory Sandbox participant', size: 18, color: GREY, font: 'Calibri' }),
          ],
        }),

        new Paragraph({
          spacing: { before: 120, after: 200 },
          children: [
            new TextRun({
              text: 'Request for a Variation to Testing Parameters',
              bold: true,
              size: 30,
              color: NAVY,
              font: 'Calibri',
            }),
          ],
        }),
        new Paragraph({
          spacing: { after: 260 },
          children: [new TextRun({ text: 'Agent Participant Class', size: 24, color: GREY, font: 'Calibri' })],
        }),

        // ── Address block ─────────────────────────────────────────────────
        new Table({
          columnWidths: [1700, 7326],
          width: { size: USABLE, type: WidthType.DXA },
          borders: {
            top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
            insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
          },
          rows: [
            ['To', 'Bank of Tanzania — Regulatory Sandbox / National Payment Systems'],
            ['From', 'NEDA Labs Limited'],
            ['Subject', 'Proposed variation to Testing Parameters #2, #3 and #4 to permit a supervised pilot with mobile-money agents (wakala)'],
            ['Classification', 'Regulatory — Bank of Tanzania Sandbox Submission'],
          ].map(([k, v]) =>
            new TableRow({
              children: [
                cell(k, { widths: 1700, bold: true }),
                cell(v, { widths: 7326 }),
              ],
            })
          ),
        }),
        spacer(240),

        // ── 1 ─────────────────────────────────────────────────────────────
        h('1.  Purpose'),
        p('NEDA Labs requests a variation to the approved Testing Parameters to permit a ring-fenced pilot in which mobile-money agents participate as a distinct class, with limits calibrated to a small business rather than an individual consumer.'),
        p('We are not requesting a change to the general consumer parameters, and we are not requesting an increase in the overall value at risk beyond what is set out in Section 6.'),

        // ── 2 ─────────────────────────────────────────────────────────────
        h('2.  The problem observed in the market'),
        p('A wakala serves customers from two pools of liquidity: cash in the drawer, and electronic float held separately with each provider. Their working day is constrained less by demand than by the composition of that float.'),
        p('Field observation of an operating agent in Dar es Salaam on 27 July 2026 recorded:'),
        spacer(80),
        table(
          [6026, 3000],
          ['Measure', 'Observed'],
          [
            ['Agent commission, 50,000 TZS cash-out', '322 TZS'],
            ['Agent commission, 50,000 TZS cash-in', '295 TZS'],
          ]
        ),
        spacer(160),
        p('At those margins an agent must transact continuously to be viable, and every interruption is lost income.'),
        rich([
          'The interruption we set out to address is not the movement of float between networks — the Tanzania Instant Payment System has made that fast and free, and we do not seek to duplicate it. It is the transactions an agent ',
          { t: 'cannot', b: true },
          ' offer at all from a single balance: utility bills, Government e-Payment Gateway control numbers, bank transfers, and merchant payments across networks. Each is revenue foregone by the agent and a service the customer must seek elsewhere.',
        ]),

        // ── 3 ─────────────────────────────────────────────────────────────
        h('3.  What we have built'),
        p('A capability enabling a licensed payment service provider to give each of its agents one digital float which can settle to any mobile wallet, any merchant till on any network, and any biller — from a single balance.'),
        rich([
          'The capability is complete, tested, and deployed behind a control flag. It is ',
          { t: 'not enabled', b: true },
          ", and will not be enabled without the Bank's agreement to the parameters under which it would operate.",
        ]),
        p('Prospective deployment partner: a licensed payment service provider operating an agent management platform in Tanzania. No agent has been onboarded.'),

        // ── 4 ─────────────────────────────────────────────────────────────
        h('4.  How the current parameters bind'),
        p('The approved parameters apply per participant:'),
        spacer(80),
        table(
          [6026, 3000],
          ['Parameter', 'Approved value'],
          [
            ['#2 — Participants', '100'],
            ['#3 — Per transaction', '1,000,000 TZS'],
            ['#4 — Per participant, per day', '2,000,000 TZS'],
            ['#5 — Per participant, 30 days', '60,000,000 TZS'],
          ]
        ),
        spacer(160),
        p('An agent transacting fifty times a day at 50,000 TZS turns over 2,500,000 TZS — exceeding the daily parameter before midday. The parameters are calibrated for an individual consumer, which is correct for consumers and simply does not describe an agent’s activity.'),

        // ── 5 ─────────────────────────────────────────────────────────────
        h('5.  Design decision we wish to draw to the Bank’s attention'),
        p('Each agent float is held in a sub-account beneath the partner’s account. Such sub-accounts sit outside the per-participant counting used for individual users, and could therefore have been implemented in a way that placed agent volume beyond the approved limits without any parameter change.'),
        rich([
          { t: 'We did not implement it that way.', b: true },
          ' Every disbursement records the float that funded it, and the same daily and monthly ceilings are counted against each float exactly as they are against an individual. Provisioning a second float creates another participant against Parameter #2; it does not create additional headroom. This is enforced in code and verified by an automated test that fails our build if any future change counts a float’s activity against anything other than itself.',
        ]),
        rich([
          'We mention this because it explains why we are before the Bank at all: ',
          { t: 'the constraint we have encountered is one we chose to keep.', b: true },
        ]),

        // ── 6 ─────────────────────────────────────────────────────────────
        h('6.  Requested variation'),
        p('We propose an agent participant class, applying only to floats operated by agents of a licensed payment service provider under a written agreement with NEDA Labs:'),
        spacer(80),
        table(
          [2400, 1900, 2126, 2600],
          ['Parameter', 'Approved', 'Requested', 'Rationale'],
          [
            ['#2 — Participants', '100', '100 + 20 agents', 'Meaningful cohort, small enough to supervise'],
            ['#3 — Per transaction', '1,000,000 TZS', 'Unchanged', 'No single transaction needs to be larger'],
            ['#4 — Per agent, daily', '2,000,000 TZS', '10,000,000 TZS', '~200 transactions at observed average size'],
            ['#5 — Per agent, 30 days', '60,000,000 TZS', '200,000,000 TZS', 'Consistent with the daily figure over a working month'],
          ]
        ),
        spacer(160),
        rich([
          'Maximum additional value at risk across the agent cohort: ',
          { t: '200,000,000 TZS per day', b: true },
          ', fully backed by the reserve on the same terms as all other nTZS in issue.',
        ]),

        // ── 7 ─────────────────────────────────────────────────────────────
        h('7.  Controls applying to the agent class'),
        numbered(1, [{ t: 'Identity. ', b: true }, 'Every agent is verified against NIDA before a float is issued. The operating partner is subject to business verification (KYB) reviewed under maker–checker control before the capability is enabled for them.']),
        numbered(2, [{ t: 'Reserve. ', b: true }, 'Agent floats are nTZS and are backed one-for-one by the same reserve, reported in the same daily attestation. The variation changes the volume of activity, not the backing.']),
        numbered(3, [{ t: 'Per-float accounting. ', b: true }, 'Each float’s daily and monthly usage is counted and enforced independently, as described in Section 5.']),
        numbered(4, [{ t: 'Reporting. ', b: true }, 'We will report agent-cohort activity separately in the periodic return: floats issued, volume and value by destination type (wallet, till, biller), and exceptions.']),
        numbered(5, [{ t: 'Suspension. ', b: true }, 'The capability is governed by a single control flag and a per-partner permission. Either can be withdrawn immediately, and doing so halts all agent activity without affecting other participants.']),

        // ── 8 ─────────────────────────────────────────────────────────────
        h('8.  What the pilot would evidence'),
        p('The Bank has an interest in whether digital settlement widens the services available at the agent counter, which is where most Tanzanians meet the financial system. A supervised cohort would produce direct evidence on:'),
        bullet('whether agents take up bill payment, government payments and bank transfers when the capital constraint is removed'),
        bullet('the effect on agent income, measured against the baseline in Section 2'),
        bullet('transaction success rates and settlement times by destination type'),
        bullet('whether customers are served for a wider set of needs at the same counter'),
        spacer(60),
        p('We would share this data with the Bank in full, including results that do not support the proposition.'),

        // ── 9 ─────────────────────────────────────────────────────────────
        h('9.  Requested next step'),
        p('A meeting to discuss the proposed parameters and reporting format, at the Bank’s convenience. We will not enable the capability for any agent until the Bank has confirmed the parameters under which the pilot may operate.'),

        // ── Signature ─────────────────────────────────────────────────────
        new Paragraph({ spacing: { before: 380, after: 200 }, border: { bottom: RULE }, children: [] }),
        p('NEDA Labs Limited', { bold: true, after: 40 }),
        p('Victor A. Muhagachi', { after: 20 }),
        p('Chief Technology Officer', { color: GREY, after: 20 }),
        p('victor@nedapay.xyz', { color: GREY }),
      ],
    },
  ],
})

Packer.toBuffer(doc).then((b) => {
  fs.writeFileSync(process.argv[2], b)
  console.log('written:', process.argv[2])
})
