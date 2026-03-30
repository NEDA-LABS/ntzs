import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const COOKIE = 'fx_session';
const ALG = 'HS256';

function getSecret(): Uint8Array {
  const s = process.env.FX_JWT_SECRET;
  if (!s) throw new Error('FX_JWT_SECRET env var not set');
  return new TextEncoder().encode(s);
}

export async function createSession(lpId: string): Promise<string> {
  return new SignJWT({ lpId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<{ lpId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return { lpId: payload.lpId as string };
  } catch {
    return null;
  }
}

export async function getSessionFromCookies(): Promise<{ lpId: string } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
