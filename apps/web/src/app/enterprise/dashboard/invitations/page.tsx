'use client'

import { useEffect, useState } from 'react'

interface Invitation {
  id: string
  direction: 'invite' | 'application'
  status: string
  proposedSplitPct: number | null
  message: string | null
  respondedAt: string | null
  createdAt: string
  merchantId: string
  merchantName: string | null
  merchantHandle: string
  merchantEmail: string
}

interface SearchResult {
  id: string
  businessName: string | null
  handle: string
  email: string
  settlePct: number
  lenderPartnerId: string | null
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending:   'text-amber-700 bg-amber-50 border-amber-200',
    accepted:  'text-emerald-700 bg-emerald-50 border-emerald-200',
    rejected:  'text-gray-500 bg-gray-100 border-gray-200',
    cancelled: 'text-gray-400 bg-gray-100 border-gray-200',
  }
  return (
    <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border rounded ${styles[status] ?? styles.pending}`}>
      {status}
    </span>
  )
}

export default function InvitationsPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'inbox' | 'sent'>('inbox')

  const [merchantSearch, setMerchantSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedMerchant, setSelectedMerchant] = useState<SearchResult | null>(null)
  const [proposedSplit, setProposedSplit] = useState(30)
  const [inviteMessage, setInviteMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendSuccess, setSendSuccess] = useState('')

  const [responding, setResponding] = useState<string | null>(null)

  useEffect(() => {
    fetch('/enterprise/api/lender/invitations')
      .then(r => r.json())
      .then(d => setInvitations(d.invitations ?? []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!merchantSearch.trim()) { setSearchResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/backstage/api/merchants?q=${encodeURIComponent(merchantSearch)}`)
        const data = await res.json()
        setSearchResults(data.merchants ?? [])
      } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [merchantSearch])

  async function handleSendInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedMerchant) return
    setSending(true); setSendError(''); setSendSuccess('')
    try {
      const res = await fetch('/enterprise/api/lender/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: selectedMerchant.id,
          proposedSplitPct: proposedSplit,
          message: inviteMessage || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSendError(data.error ?? 'Failed to send invite'); return }
      setSendSuccess(`Invite sent to ${selectedMerchant.businessName ?? selectedMerchant.handle}`)
      setSelectedMerchant(null); setMerchantSearch(''); setInviteMessage(''); setProposedSplit(30)
      const updated = await fetch('/enterprise/api/lender/invitations').then(r => r.json())
      setInvitations(updated.invitations ?? [])
    } catch { setSendError('Network error') }
    finally { setSending(false) }
  }

  async function handleRespond(id: string, action: 'accept' | 'reject') {
    setResponding(id)
    try {
      await fetch(`/enterprise/api/lender/invitations/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const updated = await fetch('/enterprise/api/lender/invitations').then(r => r.json())
      setInvitations(updated.invitations ?? [])
    } finally { setResponding(null) }
  }

  const incomingApplications = invitations.filter(i => i.direction === 'application' && i.status === 'pending')
  const sentInvites = invitations.filter(i => i.direction === 'invite')
  const allResolved = invitations.filter(i => i.status !== 'pending')

  if (loading) return (
    <div className="p-10">
      <div className="animate-pulse h-8 w-48 bg-gray-200 rounded" />
    </div>
  )

  return (
    <div className="p-10 max-w-4xl space-y-10">
      <div>
        <p className="text-[10px] tracking-widest text-gray-400 uppercase mb-1">Capital Lender</p>
        <h1 className="text-2xl font-light text-gray-900">Invitations</h1>
        <p className="text-sm text-gray-400 mt-1">Invite merchants or review applications</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Send Invite */}
        <div className="space-y-5">
          <h2 className="text-sm font-medium text-gray-700">Send Invite</h2>
          <form onSubmit={handleSendInvite} className="border border-gray-200 bg-white rounded-xl shadow-sm p-5 space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-2">Search merchant</label>
              <input
                type="text"
                value={merchantSearch}
                onChange={e => setMerchantSearch(e.target.value)}
                placeholder="Name, handle, or email"
                className="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg px-3 py-2 placeholder-gray-400 focus:outline-none focus:border-indigo-500"
              />
              {searching && <p className="text-xs text-gray-400 mt-1">Searching…</p>}
              {searchResults.length > 0 && !selectedMerchant && (
                <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                  {searchResults.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setSelectedMerchant(m); setMerchantSearch(m.businessName ?? m.handle); setSearchResults([]) }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors ${i > 0 ? 'border-t border-gray-100' : ''}`}
                    >
                      <span className="text-gray-800">{m.businessName ?? m.handle}</span>
                      <span className="text-xs text-gray-400">
                        {m.handle}
                        {m.lenderPartnerId ? ' · already linked' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedMerchant && (
              <>
                <div className="flex items-center justify-between border border-indigo-200 bg-indigo-50 rounded-lg px-4 py-2.5">
                  <div>
                    <p className="text-sm text-gray-900 font-medium">{selectedMerchant.businessName ?? selectedMerchant.handle}</p>
                    <p className="text-xs text-gray-500">@{selectedMerchant.handle} · current settle {selectedMerchant.settlePct}%</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedMerchant(null); setMerchantSearch('') }}
                    className="text-xs text-gray-400 hover:text-gray-700"
                  >
                    ✕
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-2">
                    Proposed repayment split % <span className="text-gray-300">(max {99 - selectedMerchant.settlePct}%)</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={99 - selectedMerchant.settlePct}
                    value={proposedSplit}
                    onChange={e => setProposedSplit(Number(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-2">Message <span className="text-gray-300">(optional)</span></label>
                  <textarea
                    rows={2}
                    value={inviteMessage}
                    onChange={e => setInviteMessage(e.target.value)}
                    placeholder="Brief note to the merchant…"
                    className="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg px-3 py-2 placeholder-gray-400 focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>
              </>
            )}

            {sendError && <p className="text-xs text-red-600">{sendError}</p>}
            {sendSuccess && <p className="text-xs text-emerald-600">{sendSuccess}</p>}

            <button
              type="submit"
              disabled={!selectedMerchant || sending}
              className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
            >
              {sending ? 'Sending…' : 'Send Invite'}
            </button>
          </form>
        </div>

        {/* Right: Inbox */}
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            {['inbox', 'sent'].map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t as 'inbox' | 'sent')}
                className={`text-xs tracking-wider uppercase pb-1 border-b-2 transition-colors ${
                  activeTab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-700'
                }`}
              >
                {t === 'inbox' ? `Inbox${incomingApplications.length > 0 ? ` (${incomingApplications.length})` : ''}` : 'Sent'}
              </button>
            ))}
          </div>

          {activeTab === 'inbox' && (
            <div className="space-y-3">
              {incomingApplications.length === 0 ? (
                <div className="border border-gray-100 rounded-xl p-8 text-center">
                  <p className="text-xs text-gray-400">No pending applications</p>
                </div>
              ) : incomingApplications.map(app => (
                <div key={app.id} className="border border-gray-200 rounded-xl p-4 space-y-3 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-gray-900 font-medium">{app.merchantName ?? app.merchantHandle}</p>
                      <p className="text-xs text-gray-400">@{app.merchantHandle} · {fmt(app.createdAt)}</p>
                    </div>
                    <StatusBadge status={app.status} />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRespond(app.id, 'accept')}
                      disabled={responding === app.id}
                      className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleRespond(app.id, 'reject')}
                      disabled={responding === app.id}
                      className="px-3 py-1.5 text-xs border border-gray-200 text-gray-500 hover:text-gray-900 hover:border-gray-400 rounded transition-colors disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}

              {allResolved.filter(i => i.direction === 'application').length > 0 && (
                <div className="space-y-2 mt-4">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Resolved</p>
                  {allResolved.filter(i => i.direction === 'application').map(app => (
                    <div key={app.id} className="flex items-center justify-between border border-gray-100 rounded-lg px-4 py-2.5">
                      <div>
                        <p className="text-xs text-gray-700">{app.merchantName ?? app.merchantHandle}</p>
                        <p className="text-[10px] text-gray-400">{fmt(app.createdAt)}</p>
                      </div>
                      <StatusBadge status={app.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'sent' && (
            <div className="space-y-2">
              {sentInvites.length === 0 ? (
                <div className="border border-gray-100 rounded-xl p-8 text-center">
                  <p className="text-xs text-gray-400">No invites sent yet</p>
                </div>
              ) : sentInvites.map(inv => (
                <div key={inv.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3 shadow-sm">
                  <div>
                    <p className="text-sm text-gray-800">{inv.merchantName ?? inv.merchantHandle}</p>
                    <p className="text-xs text-gray-400">
                      @{inv.merchantHandle}
                      {inv.proposedSplitPct != null ? ` · ${inv.proposedSplitPct}% split` : ''}
                      {' · '}{fmt(inv.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={inv.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
