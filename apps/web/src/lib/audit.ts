import { auditLogs } from '@ntzs/db'
import { getDb } from '@/lib/db'

type AuditMeta = Record<string, unknown> | null

/**
 * Write a single audit log entry. Fire-and-forget safe — errors are logged
 * but never thrown so they cannot break the calling action.
 */
export async function writeAuditLog(
  action: string,
  entityType: string,
  entityId: string,
  metadata?: AuditMeta,
  actorUserId?: string | null,
): Promise<void> {
  try {
    const { db } = getDb()
    await db.insert(auditLogs).values({
      action,
      entityType,
      entityId,
      metadata: metadata ?? null,
      actorUserId: actorUserId ?? null,
    })
  } catch (err) {
    console.error('[audit] Failed to write audit log:', action, entityType, entityId, err)
  }
}
