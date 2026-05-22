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
    pending: 'text-amber-400 bg-amber-950 border-amber-900',
    accepted: 'text-emerald-400 bg-emerald-950 border-emerald-900',
    rejected: 'text-zinc-500 bg-zinc-900 border-zinc-800',
    cancelled: 'text-zinc-600 bg-zinc-950 border-zinc-800',
  }
  return (
    <span className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border ${styles[status] ?? styles.pending}`}>
      {status}
    </span>
  )
}

export default function InvitationsPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'inbox' | 'sent'>('inbox')

  // Send invite form
  const [merchantSearch, setMerchantSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedMerchant, setSelectedMerchant] = useState<SearchResult | null>(null)
  const [proposedSplit, setProposedSplit] = useState(30)
  const [inviteMessage, setInviteMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendSuccess, setSendSuccess] = useState('')

  // Respond state
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

  async function handleSendInvite(e: React.FormEvent) {
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

  if (loading) return <div className="p-10"><div className="animate-pulse h-8 w-48 bg-zinc-800 rounded" /></div>

  return (
    <div className="p-10 max-w-4xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-white">Invitations</h1>
        <p className="text-sm text-zinc-400 mt-1">Invite merchants or review applications</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Send Invite */}
        <div className="space-y-5">
          <h2 className="text-sm font-medium text-white">Send Invite</h2>
          <form onSubmit={handleSendInvite} className="border border-white/10 bg-zinc-900 rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-2">Search merchant</label>
              <input
                type="text"
                value={merchantSearch}
                onChange={e => setMerchantSearch(e.target.value)}
                placeholder="Name, handle, or email"
                className="w-full bg-zinc-950 border border-white/10 text-white text-sm rounded-lg px-3 py-2 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
              />
              {searching && <p className="text-xs text-zinc-500 mt-1">Searching…</p>}
              {searchResults.length > 0 && !selectedMerchant && (
                <div className="mt-1 border border-white/10 rounded-lg overflow-hidden">
                  {searchResults.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setSelectedMerchant(m); setMerchantSearch(m.businessName ?? m.handle); setSearchResults([]) }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-white/5 transition-colors ${i > 0 ? 'border-t border-white/5' : ''}`}
                    >
                      <span className="text-zinc-200">{m.businessName ?? m.handle}</span>
                      <span className="text-xs text-zinc-500">
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
                <div className="flex items-center justify-between border border-indigo-900/40 bg-indigo-950/20 rounded-lg px-4 py-2.5">
                  <div>
                    <p className="text-sm text-white font-medium">{selectedMerchant.businessName ?? selectedMerchant.handle}</p>
                    <p className="text-xs text-zinc-500">@{selectedMerchant.handle} · current settle {selectedMerchant.settlePct}%</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedMerchant(null); setMerchantSearch('') }}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    ✕
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-2">
                    Proposed repayment split % <span className="text-zinc-600">(max {99 - selectedMerchant.settlePct}%)</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={99 - selectedMerchant.settlePct}
                    value={proposedSplit}
                    onChange={e => setProposedSplit(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-2">Message <span className="text-zinc-600">(optional)</span></label>
                  <textarea
                    rows={2}
                    value={inviteMessage}
                    onChange={e => setInviteMessage(e.target.value)}
                    placeholder="Brief note to the merchant…"
                    className="w-full bg-zinc-950 border border-white/10 text-white text-sm rounded-lg px-3 py-2 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>
              </>
            )}

            {sendError && <p className="text-xs text-red-400">{sendError}</p>}
            {sendSuccess && <p className="text-xs text-emerald-400">{sendSuccess}</p>}

            <button
              type="submit"
              disabled={!selectedMerchant || sending}
              className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
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
                  activeTab === t ? 'border-indigo-400 text-indigo-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {t === 'inbox' ? `Inbox${incomingApplications.length > 0 ? ` (${incomingApplications.length})` : ''}` : 'Sent'}
              </button>
            ))}
          </div>

          {activeTab === 'inbox' && (
            <div className="space-y-3">
              {incomingApplications.length === 0 ? (
                <div className="border border-white/5 rounded-xl p-8 text-center">
                  <p className="text-xs text-zinc-600">No pending applications</p>
                </div>
              ) : incomingApplications.map(app => (
                <div key={app.id} className="border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-white font-medium">{app.merchantName ?? app.merchantHandle}</p>
                      <p className="text-xs text-zinc-500">@{app.merchantHandle} · {fmt(app.createdAt)}</p>
                    </div>
                    <StatusBadge status={app.status} />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRespond(app.id, 'accept')}
                      disabled={responding === app.id}
                      className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleRespond(app.id, 'reject')}
                      disabled={responding === app.id}
                      className="px-3 py-1.5 text-xs border border-white/10 text-zinc-400 hover:text-white rounded transition-colors disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}

              {/* Resolved */}
              {allResolved.filter(i => i.direction === 'application').length > 0 && (
                <div className="space-y-2 mt-4">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Resolved</p>
                  {allResolved.filter(i => i.direction === 'application').map(app => (
                    <div key={app.id} className="flex items-center justify-between border border-white/5 rounded-lg px-4 py-2.5">
                      <div>
                        <p className="text-xs text-zinc-300">{app.merchantName ?? app.merchantHandle}</p>
                        <p className="text-[10px] text-zinc-600">{fmt(app.createdAt)}</p>
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
                <div className="border border-white/5 rounded-xl p-8 text-center">
                  <p className="text-xs text-zinc-600">No invites sent yet</p>
                </div>
              ) : sentInvites.map(inv => (
                <div key={inv.id} className="flex items-center justify-between border border-white/10 rounded-lg px-4 py-3">
                  <div>
                    <p className="text-sm text-zinc-200">{inv.merchantName ?? inv.merchantHandle}</p>
                    <p className="text-xs text-zinc-500">
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
