import { requireAnyRole } from '@/lib/auth/rbac'
import { holdersCsv, loadHoldersView } from '@/lib/holders'

export const dynamic = 'force-dynamic'

/**
 * The holders register as CSV — the artefact handed over when "a list of all
 * holders and their verification state" is asked for. Same authorisation as
 * the page; same data, so the export can never disagree with the screen.
 */
export async function GET() {
  await requireAnyRole(['super_admin', 'platform_compliance', 'bank_admin', 'bot_regulator'])

  const view = await loadHoldersView()
  const today = new Date().toISOString().slice(0, 10)

  return new Response(holdersCsv(view), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ntzs-holders-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
