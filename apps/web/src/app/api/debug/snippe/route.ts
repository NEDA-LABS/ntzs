import { NextResponse } from 'next/server'
import { getBalance } from '@/lib/psp'

export async function GET() {
  // Debug endpoint — must not exist in production (leaks PSP float balance).
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const balance = await getBalance()
    return NextResponse.json({ status: 'ok', balance })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[debug/snippe] balance fetch failed:', message)
    return NextResponse.json({ status: 'error', error: message }, { status: 500 })
  }
}
