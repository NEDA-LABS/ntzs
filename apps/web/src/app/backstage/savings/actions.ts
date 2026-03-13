'use server'

import { eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth/rbac'
import { getDb } from '@/lib/db'
import { users, fundManagers } from '@ntzs/db'

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghjkmnpqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%&*'
  const all = upper + lower + digits + symbols

  const pick = (set: string) => set[Math.floor(Math.random() * set.length)]

  // Guarantee at least one of each character class
  const required = [pick(upper), pick(lower), pick(digits), pick(symbols)]

  // Fill to 16 characters total
  const rest = Array.from({ length: 12 }, () => pick(all))

  // Shuffle the combined array (Fisher-Yates)
  const combined = [...required, ...rest]
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[combined[i], combined[j]] = [combined[j], combined[i]]
  }

  return combined.join('')
}

export type CreateFmResult =
  | { success: true; credentials: { email: string; password: string; name: string } }
  | { success: false; error: string }

export async function createFundManagerCredentials(
  formData: FormData,
): Promise<CreateFmResult> {
  try {
    await requireRole('super_admin')

    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const name = String(formData.get('name') ?? '').trim()
    const fundManagerId = String(formData.get('fundManagerId') ?? '').trim()

    if (!email) return { success: false, error: 'Email is required.' }
    if (!fundManagerId) return { success: false, error: 'Fund manager is required.' }

    const { db } = getDb()

    // Verify fund manager exists
    const [fm] = await db
      .select({ id: fundManagers.id })
      .from(fundManagers)
      .where(eq(fundManagers.id, fundManagerId))
      .limit(1)

    if (!fm) return { success: false, error: 'Fund manager not found.' }

    // Check email not already taken
    const existing = await db.query.users.findFirst({
      where: eq(users.email, email),
    })

    if (existing) return { success: false, error: 'An account with this email already exists.' }

    // Pre-register the user row — neonAuthUserId will be attached on first sign-in
    await db.insert(users).values({
      neonAuthUserId: `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      email,
      name: name || null,
      role: 'fund_manager',
      fundManagerId,
    })

    const password = generatePassword()

    return {
      success: true,
      credentials: { email, password, name: name || email },
    }
  } catch (err) {
    console.error('[createFundManagerCredentials]', err)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
}
