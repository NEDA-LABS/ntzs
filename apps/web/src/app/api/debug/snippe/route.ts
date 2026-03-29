import { NextResponse } from 'next/server'
import { getBalance } from '@/lib/psp/snippe'

export async function GET() {
  try {
    const balance = await getBalance()
    return NextResponse.json({ status: 'ok', balance })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[debug/snippe] balance fetch failed:', message)
    return NextResponse.json({ status: 'error', error: message }, { status: 500 })
  }
}
