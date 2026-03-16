import { NextResponse } from 'next/server'

// Stub auth handler - Neon Auth API has changed
// TODO: Update to new Neon Auth API when documentation is available
export async function GET() {
  return NextResponse.json({ error: 'Auth endpoint temporarily disabled' }, { status: 501 })
}

export async function POST() {
  return NextResponse.json({ error: 'Auth endpoint temporarily disabled' }, { status: 501 })
}
