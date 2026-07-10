import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'

import { verifySessionToken } from '@/lib/waas/auth'

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const DOC_KEYS = ['cert_of_incorporation', 'regulatory_license', 'aml_policy'] as const
type DocKey = typeof DOC_KEYS[number]

export async function POST(request: NextRequest) {
  const token =
    request.cookies.get('partner_session')?.value ||
    (request.headers.get('authorization')?.startsWith('Bearer ')
      ? request.headers.get('authorization')!.slice(7)
      : null)
  const partnerId = token ? verifySessionToken(token) : null
  if (!partnerId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const docType = formData.get('docType') as string | null

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!docType || !(DOC_KEYS as readonly string[]).includes(docType)) {
    return NextResponse.json({ error: 'docType must be one of: ' + DOC_KEYS.join(', ') }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'File must be PDF, JPEG, PNG, or WebP' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 })
  }

  const ext = file.name.split('.').pop() ?? 'bin'
  const pathname = `kyb/${partnerId}/${docType as DocKey}.${ext}`

  // addRandomSuffix makes the URL unguessable — Vercel Blob is public-access,
  // and a deterministic kyb/{partnerId}/{docType} path would leave compliance
  // documents (licences, AML policies) readable by anyone who derives the URL.
  const blob = await put(pathname, file, {
    access: 'public',
    addRandomSuffix: true,
  })

  return NextResponse.json({ url: blob.url })
}
