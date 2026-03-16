import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Stub middleware - Neon Auth API has changed
// TODO: Update to new Neon Auth API when documentation is available
export default function middleware(request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ['/account/:path*', '/app/:path*', '/ops/:path*', '/backstage/:path*'],
}
