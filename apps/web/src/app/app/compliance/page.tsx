import Link from 'next/link'

import { requireAnyRole } from '@/lib/auth/rbac'

export default async function CompliancePage() {
  await requireAnyRole(['platform_compliance', 'super_admin', 'bot_regulator'])

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center max-w-sm px-6">
        <p className="text-xs font-mono text-gray-400 uppercase tracking-widest mb-3">
          Bank of Tanzania · Sandbox Ref. LD. 170/515/02/1254
        </p>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">
          nTZS Compliance Portal
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          Live operational data, reserve status, and regulatory monitoring for the nTZS sandbox.
        </p>
        <Link
          href="/app/oversight"
          className="inline-block bg-gray-900 text-white text-sm font-medium px-6 py-3 rounded-lg hover:bg-gray-700 transition-colors"
        >
          Open Oversight Dashboard
        </Link>
      </div>
    </div>
  )
}
