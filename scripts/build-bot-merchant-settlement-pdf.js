#!/usr/bin/env node
/**
 * Render the Bank of Tanzania merchant-settlement request as a letter PDF.
 *
 * Deliberately a build script rather than a hand-made document: the markdown in
 * docs/bot/ stays the single source of truth, and re-running this after an edit
 * regenerates the artefact rather than leaving two versions to drift.
 *
 * Layout choices are for a supervisory reader, not a designer: letterhead once
 * at the top, generous margins, no colour beyond a single rule, tables that
 * read as tables on paper. Nothing decorative.
 *
 *   node scripts/build-bot-merchant-settlement-pdf.js
 */

const { execFileSync } = require('child_process')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PY = path.join(__dirname, 'build-bot-merchant-settlement-pdf.py')

try {
  execFileSync('python3', [PY], { cwd: ROOT, stdio: 'inherit' })
} catch (err) {
  console.error('\nPDF build failed. Ensure reportlab is installed:  pip install reportlab')
  process.exit(typeof err.status === 'number' ? err.status : 1)
}
