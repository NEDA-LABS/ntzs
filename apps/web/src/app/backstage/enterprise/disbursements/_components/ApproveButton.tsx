'use client'

import { useState } from 'react'

export function ApproveButton({ batchId }: { batchId: string }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/backstage/enterprise/disbursements/${batchId}/approve`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      setDone(true)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  if (done) return <span className="text-xs text-emerald-400">Approved</span>
  if (error) return <span className="text-xs text-red-400">{error}</span>

  return (
    <button
      onClick={approve}
      disabled={loading}
      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs rounded transition-colors"
    >
      {loading ? 'Approving…' : 'Approve'}
    </button>
  )
}
