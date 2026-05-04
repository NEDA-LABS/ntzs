import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [salt, hash] = stored.split(':');
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    const storedBuf = Buffer.from(hash, 'hex');
    return buf.length === storedBuf.length && timingSafeEqual(buf, storedBuf);
  } catch {
    return false;
  }
}

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
    .setExpirationTime('30d')
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
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
