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

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // put() would throw an opaque 500 — say what is actually wrong: the
    // Vercel Blob store isn't connected to this project.
    console.error('[kyb/upload] BLOB_READ_WRITE_TOKEN not configured — connect a Blob store to the Vercel project')
    return NextResponse.json(
      { error: 'Document storage is not configured yet — our team has been notified. Please try again later.' },
      { status: 503 }
    )
  }

  const ext = file.name.split('.').pop() ?? 'bin'
  const pathname = `kyb/${partnerId}/${docType as DocKey}.${ext}`

  try {
    // PRIVATE store: compliance documents are never publicly reachable — the
    // only read path is /api/kyb-docs/:partnerId/:docType, which authorizes
    // (owning partner or backstage staff) and streams the blob server-side.
    const blob = await put(pathname, file, {
      access: 'private',
      addRandomSuffix: true,
    })
    return NextResponse.json({ url: blob.url })
  } catch (err) {
    console.error('[kyb/upload] blob upload failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Document upload failed — please try again.' }, { status: 502 })
  }
}
