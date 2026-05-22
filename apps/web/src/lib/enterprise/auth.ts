import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'crypto'
import { promisify } from 'util'

const scryptAsync = promisify(scrypt)

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const buf = (await scryptAsync(password, salt, 64)) as Buffer
  return `${salt}:${buf.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [salt, hash] = stored.split(':')
    const buf = (await scryptAsync(password, salt, 64)) as Buffer
    const storedBuf = Buffer.from(hash, 'hex')
    return buf.length === storedBuf.length && timingSafeEqual(buf, storedBuf)
  } catch {
    return false
  }
}

const COOKIE = 'enterprise_session'
const ALG = 'HS256'

function getSecret(): Uint8Array {
  const s = process.env.ENTERPRISE_JWT_SECRET
  if (!s) throw new Error('ENTERPRISE_JWT_SECRET env var not set')
  return new TextEncoder().encode(s)
}

export async function createSession(enterpriseId: string): Promise<string> {
  return new SignJWT({ enterpriseId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret())
}

export async function verifySession(token: string): Promise<{ enterpriseId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return { enterpriseId: payload.enterpriseId as string }
  } catch {
    return null
  }
}

export async function getSessionFromCookies(): Promise<{ enterpriseId: string } | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null
  return verifySession(token)
}

export async function setSessionCookie(token: string) {
  const jar = await cookies()
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/enterprise',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export async function clearSessionCookie() {
  const jar = await cookies()
  jar.delete(COOKIE)
}

// ─── Invite tokens (magic link after ops approval) ───────────────────────────

export function generateInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

export function hashInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

// ─── OTP utilities (same pattern as merchant OTPs) ───────────────────────────

export async function hashOtp(code: string): Promise<string> {
  const hash = createHash('sha256').update(code).digest('hex')
  return hash
}

export function verifyOtpHash(code: string, stored: string): boolean {
  const hash = createHash('sha256').update(code).digest('hex')
  return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored, 'hex'))
}
