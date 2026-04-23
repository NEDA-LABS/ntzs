import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { lpAccounts } from '@ntzs/db';

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
    path: '/simplefx',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

// ── MM API Key Authentication ─────────────────────────────────────────────────

export function hashMmApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function generateMmApiKey(): string {
  const rand = crypto.randomBytes(24).toString('base64url');
  return `mm_live_${rand}`;
}

export interface AuthenticatedMM {
  lpId: string;
  email: string;
  walletAddress: string;
  walletIndex: number;
  bidBps: number;
  askBps: number;
  isActive: boolean;
  kycStatus: string;
}

export async function authenticateMM(
  request: NextRequest
): Promise<{ mm: AuthenticatedMM } | { error: NextResponse }> {
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: NextResponse.json(
        { error: 'Missing or invalid Authorization header. Expected: Bearer <api_key>' },
        { status: 401 }
      ),
    };
  }

  const rawKey = authHeader.slice(7);
  if (!rawKey.startsWith('mm_live_') && !rawKey.startsWith('mm_test_')) {
    return {
      error: NextResponse.json({ error: 'Invalid API key format' }, { status: 401 }),
    };
  }

  const keyHash = hashMmApiKey(rawKey);
  const { db } = getDb();

  const [lp] = await db
    .select({
      id: lpAccounts.id,
      email: lpAccounts.email,
      walletAddress: lpAccounts.walletAddress,
      walletIndex: lpAccounts.walletIndex,
      bidBps: lpAccounts.bidBps,
      askBps: lpAccounts.askBps,
      isActive: lpAccounts.isActive,
      kycStatus: lpAccounts.kycStatus,
    })
    .from(lpAccounts)
    .where(eq(lpAccounts.apiKeyHash, keyHash))
    .limit(1);

  if (!lp) {
    return {
      error: NextResponse.json({ error: 'Invalid API key' }, { status: 401 }),
    };
  }

  return {
    mm: {
      lpId: lp.id,
      email: lp.email,
      walletAddress: lp.walletAddress,
      walletIndex: lp.walletIndex,
      bidBps: lp.bidBps,
      askBps: lp.askBps,
      isActive: lp.isActive,
      kycStatus: lp.kycStatus,
    },
  };
}
