import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE = 'fx_session';

function getSecret(): Uint8Array {
  const s = process.env.FX_JWT_SECRET;
  if (!s) return new TextEncoder().encode('dev-secret-change-in-prod');
  return new TextEncoder().encode(s);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith('/dashboard')) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  try {
    await jwtVerify(token, getSecret());
    return NextResponse.next();
  } catch {
    const res = NextResponse.redirect(new URL('/', req.url));
    res.cookies.delete(COOKIE);
    return res;
  }
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
