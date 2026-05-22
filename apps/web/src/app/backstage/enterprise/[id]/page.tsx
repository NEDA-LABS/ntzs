'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface EnterpriseAccount {
  id: string
  name: string | null
  email: string
  type: 'capital_lender' | 'disbursement_client'
  isActive: boolean
  partnerId: string | null
  createdAt: string
}

interface Partner {
  id: string
  name: string | null
}

interface Merchant {
  id: string
  businessName: string | null
  handle: string
  email: string
  settlePct: number
  lenderPartnerId: string | null
  lenderSplitPct: number
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(n)
}

export default function BackstageEnterpriseDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [account, setAccount] = useState<EnterpriseAccount | null>(null)
  const [partners, setPartners] = useState<Partner[]>([])
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [merchantSearch, setMerchantSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Merchant[]>([])
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(true)

  // Approve state
  const [partnerId, setPartnerId] = useState('')
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [approveSuccess, setApproveSuccess] = useState<string | null>(null)

  // Link merchant state
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null)
  const [splitPct, setSplitPct] = useState(30)
  const [principalTzs, setPrincipalTzs] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/backstage/api/enterprise/${id}`).then(r => r.json()),
      fetch('/backstage/api/partners').then(r => r.json()),
    ]).then(([accData, partnerData]) => {
      setAccount(accData.account)
      setPartners(partnerData.partners ?? [])
      if (accData.account?.partnerId) setPartnerId(accData.account.partnerId)
    }).finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!merchantSearch.trim()) { setSearchResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/backstage/api/merchants?q=${encodeURIComponent(merchantSearch)}`)
        const data = await res.json()
        setSearchResults(data.merchants ?? [])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [merchantSearch])

  async function handleApprove() {
    setApproving(true)
    setApproveError(null)
    setApproveSuccess(null)
    try {
      const res = await fetch(`/api/backstage/enterprise/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: partnerId || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setApproveError(data.error ?? 'Approval failed'); return }
      setApproveSuccess(`Invite sent to ${account?.email}.`)
      setAccount(prev => prev ? { ...prev, isActive: true, partnerId: partnerId || prev.partnerId } : prev)
    } catch {
      setApproveError('Network error — please try again.')
    } finally {
      setApproving(false)
    }
  }

  async function handleLinkMerchant() {
    if (!selectedMerchant) return
    setLinking(true)
    setLinkError(null)
    setLinkSuccess(null)
    try {
      const body: Record<string, unknown> = {
        enterpriseAccountId: id,
        merchantId: selectedMerchant.id,
        lenderSplitPct: splitPct,
      }
      if (principalTzs && parseFloat(principalTzs) > 0) {
        body.principalTzs = Math.trunc(parseFloat(principalTzs))
      }
      const res = await fetch('/api/backstage/enterprise/link-merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setLinkError(data.error ?? 'Link failed'); return }
      setLinkSuccess(`${selectedMerchant.businessName ?? selectedMerchant.handle} linked with ${splitPct}% split.`)
      setMerchants(prev => [...prev, { ...selectedMerchant, lenderSplitPct: splitPct }])
      setSelectedMerchant(null)
      setMerchantSearch('')
      setSearchResults([])
      setPrincipalTzs('')
    } catch {
      setLinkError('Network error — please try again.')
    } finally {
      setLinking(false)
    }
  }

  if (loading) {
    return <div className="p-10"><div className="animate-pulse h-8 w-48 bg-zinc-800 rounded" /></div>
  }

  if (!account) {
    return (
      <div className="p-10">
        <p className="text-sm text-zinc-500">Account not found.</p>
        <Link href="/backstage/enterprise" className="text-xs text-indigo-400 mt-2 inline-block">← Back</Link>
      </div>
    )
  }

  const isLender = account.type === 'capital_lender'

  return (
    <div className="p-10 max-w-3xl space-y-8">
      <div>
        <Link
          href={isLender ? '/backstage/enterprise/lenders' : '/backstage/enterprise'}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ← {isLender ? 'Capital Lenders' : 'Enterprise Accounts'}
        </Link>
        <h1 className="text-2xl font-semibold text-white mt-2">{account.name ?? account.email}</h1>
        <p className="text-sm text-zinc-500 mt-0.5">{account.email}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Type', value: isLender ? 'Capital Lender' : 'Disbursement Client' },
          { label: 'Status', value: account.isActive ? 'Active' : 'Pending Approval' },
          { label: 'Signed Up', value: new Date(account.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) },
          { label: 'Partner Linked', value: account.partnerId ? 'Yes' : 'No' },
        ].map(c => (
          <div key={c.label} className="border border-white/10 bg-zinc-900 rounded-xl p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{c.label}</p>
            <p className="text-sm text-white">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Pending approval flow */}
      {!account.isActive && (
        <div className="border border-amber-900/50 bg-amber-950/20 rounded-xl p-6 space-y-5">
          <h2 className="text-sm font-medium text-amber-400">Approve & Send Invite</h2>
          <div>
            <label className="block text-xs text-zinc-400 mb-2">
              Link to Partner <span className="text-zinc-600">(required for capital lenders)</span>
            </label>
            <select
              value={partnerId}
              onChange={e => setPartnerId(e.target.value)}
              className="w-full bg-zinc-900 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              <option value="">— Select partner —</option>
              {partners.map(p => (
                <option key={p.id} value={p.id}>{p.name ?? p.id}</option>
              ))}
            </select>
          </div>
          {approveError && <p className="text-xs text-red-400">{approveError}</p>}
          {approveSuccess && <p className="text-xs text-emerald-400">{approveSuccess}</p>}
          <button
            onClick={handleApprove}
            disabled={approving}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {approving ? 'Sending invite…' : 'Approve & Send Invite'}
          </button>
        </div>
      )}

      {/* Capital lender: link merchants */}
      {account.isActive && isLender && (
        <div className="space-y-5">
          <h2 className="text-base font-medium text-white">Link Merchant to This Lender</h2>

          {/* Merchant search */}
          <div className="border border-white/10 bg-zinc-900 rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-2">Search merchant (name, handle, or email)</label>
              <input
                type="text"
                value={merchantSearch}
                onChange={e => setMerchantSearch(e.target.value)}
                placeholder="e.g. Karibu Store"
                className="w-full bg-zinc-950 border border-white/10 text-white text-sm rounded-lg px-3 py-2 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {searching && <p className="text-xs text-zinc-500">Searching…</p>}

            {searchResults.length > 0 && !selectedMerchant && (
              <div className="border border-white/10 rounded-lg overflow-hidden">
                {searchResults.map((m, i) => (
                  <button
                    key={m.id}
                    onClick={() => { setSelectedMerchant(m); setMerchantSearch(m.businessName ?? m.handle); setSearchResults([]) }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-white/5 transition-colors ${i > 0 ? 'border-t border-white/5' : ''}`}
                  >
                    <span className="text-zinc-200">{m.businessName ?? m.handle}</span>
                    <span className="text-xs text-zinc-500">{m.handle} · settle {m.settlePct}%{m.lenderPartnerId ? ' · already linked' : ''}</span>
                  </button>
                ))}
              </div>
            )}

            {selectedMerchant && (
              <div className="border border-indigo-900/50 bg-indigo-950/20 rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white font-medium">{selectedMerchant.businessName ?? selectedMerchant.handle}</p>
                    <p className="text-xs text-zinc-500">Current settlePct: {selectedMerchant.settlePct}%</p>
                  </div>
                  <button onClick={() => { setSelectedMerchant(null); setMerchantSearch('') }} className="text-xs text-zinc-500 hover:text-zinc-300">
                    ✕ Clear
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-2">
                      Lender split % <span className="text-zinc-600">(max {99 - selectedMerchant.settlePct}%)</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={99 - selectedMerchant.settlePct}
                      value={splitPct}
                      onChange={e => setSplitPct(Number(e.target.value))}
                      className="w-full bg-zinc-950 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-2">
                      Loan principal (TZS) <span className="text-zinc-600">optional</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={principalTzs}
                      onChange={e => setPrincipalTzs(e.target.value)}
                      placeholder="e.g. 5000000"
                      className="w-full bg-zinc-950 border border-white/10 text-white text-sm rounded-lg px-3 py-2 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Preview split */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {[
                    { label: 'Lender (Ramani)', pct: splitPct, color: 'text-indigo-400' },
                    { label: 'Merchant', pct: selectedMerchant.settlePct, color: 'text-emerald-400' },
                    { label: 'NEDApay', pct: Math.max(0, 100 - splitPct - selectedMerchant.settlePct), color: 'text-zinc-400' },
                  ].map(s => (
                    <div key={s.label} className="border border-white/5 bg-zinc-950 rounded p-2 text-center">
                      <p className="text-[10px] text-zinc-600 mb-0.5">{s.label}</p>
                      <p className={`font-semibold ${s.color}`}>{s.pct}%</p>
                    </div>
                  ))}
                </div>

                {linkError && <p className="text-xs text-red-400">{linkError}</p>}
                {linkSuccess && <p className="text-xs text-emerald-400">{linkSuccess}</p>}

                <button
                  onClick={handleLinkMerchant}
                  disabled={linking || splitPct <= 0 || splitPct > 99 - selectedMerchant.settlePct}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                >
                  {linking ? 'Linking…' : 'Link merchant'}
                </button>
              </div>
            )}
          </div>

          {/* Recently linked */}
          {merchants.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Linked this session</p>
              <div className="border border-white/10 rounded-xl overflow-hidden">
                {merchants.map((m, i) => (
                  <div key={m.id} className={`flex items-center justify-between px-4 py-3 text-sm ${i > 0 ? 'border-t border-white/5' : ''}`}>
                    <span className="text-zinc-300">{m.businessName ?? m.handle}</span>
                    <span className="text-indigo-400">{m.lenderSplitPct}% split</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {account.isActive && !isLender && (
        <div className="border border-white/10 bg-zinc-900 rounded-xl p-5">
          <p className="text-sm text-zinc-400">
            Disbursement client. View pending batches in{' '}
            <Link href="/backstage/enterprise/disbursements" className="text-indigo-400 hover:text-indigo-300">
              Disbursements →
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
