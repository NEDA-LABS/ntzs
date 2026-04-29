import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const COOKIE = 'merchant_session';
const ALG = 'HS256';

function getSecret(): Uint8Array {
  const s = process.env.MERCHANT_JWT_SECRET ?? process.env.FX_JWT_SECRET;
  if (!s) throw new Error('MERCHANT_JWT_SECRET (or FX_JWT_SECRET) env var not set');
  return new TextEncoder().encode(s);
}

export async function createSession(merchantId: string): Promise<string> {
  return new SignJWT({ merchantId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<{ merchantId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return { merchantId: payload.merchantId as string };
  } catch {
    return null;
  }
}

export async function getSessionFromCookies(): Promise<{ merchantId: string } | null> {
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
    path: '/merchant',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
