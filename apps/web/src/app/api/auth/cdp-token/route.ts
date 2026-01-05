import { NextResponse } from 'next/server'
import { signCDPToken } from '@/lib/cdp-jwt'
import { neonAuth } from '@neondatabase/auth/next/server'

// Get the app's base URL for issuer/audience
function getBaseUrl() {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }
  return 'http://localhost:3000'
}

export async function GET() {
  try {
    // Use Neon Auth's server-side helper to get session
    const { session, user } = await neonAuth()
    
    console.log('[CDP-Token] Session:', session ? 'exists' : 'null')
    console.log('[CDP-Token] User:', user?.id || 'null')

    if (!session || !user) {
      return NextResponse.json(
        { error: 'No valid session found. Please log in first.' },
        { status: 401 }
      )
    }

    return await issueToken({ user, session })
  } catch (error) {
    console.error('[CDP-Token] Error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to generate CDP token',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

async function issueToken(session: { user?: { id?: string; email?: string; name?: string }; session?: { userId?: string } }) {
  const userId = session.user?.id || session.session?.userId
  
  if (!userId) {
    return NextResponse.json(
      { error: 'No user ID in session' },
      { status: 401 }
    )
  }

  const baseUrl = getBaseUrl()
  
  // Sign a new JWT with ES256 for CDP
  const token = await signCDPToken(
    {
      sub: userId,
      email: session.user?.email,
      name: session.user?.name,
    },
    baseUrl, // issuer
    baseUrl  // audience
  )

  return NextResponse.json({ token })
}

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cookie',
      'Access-Control-Allow-Credentials': 'true',
    },
  })
}
