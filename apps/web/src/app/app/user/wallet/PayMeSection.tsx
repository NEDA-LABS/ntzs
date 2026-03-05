'use client'

import { useState } from 'react'
import { updatePayAlias } from './actions'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

interface PayMeSectionProps {
  currentAlias: string | null
  suggestedAlias: string
}

export function PayMeSection({ currentAlias, suggestedAlias }: PayMeSectionProps) {
  const [alias, setAlias] = useState(currentAlias ?? '')
  const [editing, setEditing] = useState(!currentAlias)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const activeAlias = currentAlias ?? ''
  const payUrl = activeAlias ? `${APP_URL}/pay/${activeAlias}` : ''
  const qrUrl = payUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=10&data=${encodeURIComponent(payUrl)}`
    : ''

  async function handleSave() {
    setError('')
    const value = alias.trim().toLowerCase()
    if (!value) {
      setError('Enter an alias')
      return
    }

    setSaving(true)
    const fd = new FormData()
    fd.set('alias', value)
    const result = await updatePayAlias(fd)
    setSaving(false)

    if (result.success) {
      setAlias(result.alias)
      setEditing(false)
      // Force a page reload to get the updated alias from the server
      window.location.reload()
    } else {
      setError(result.error)
    }
  }

  async function handleCopyLink() {
    if (!payUrl) return
    await navigator.clipboard.writeText(payUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Pay Me</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Share your link or QR to collect payments</p>
        </div>
        {activeAlias && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10"
          >
            Edit alias
          </button>
        )}
      </div>

      {/* Alias setup / editor */}
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Your pay alias</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">@</span>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                placeholder={suggestedAlias}
                maxLength={30}
                className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
              />
            </div>
            <p className="mt-1 text-xs text-zinc-600">3-30 characters, letters, numbers, - or _</p>
          </div>

          {error && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 active:scale-[0.97] disabled:opacity-70"
            >
              {saving ? 'Saving...' : 'Save alias'}
            </button>
            {currentAlias && (
              <button
                type="button"
                onClick={() => {
                  setAlias(currentAlias)
                  setEditing(false)
                  setError('')
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-zinc-300 hover:bg-white/10"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : activeAlias ? (
        <div className="space-y-5">
          {/* QR Code */}
          <div className="flex justify-center">
            <div className="rounded-2xl border border-white/10 bg-white p-3">
              <img src={qrUrl} alt="Pay Me QR" width={220} height={220} className="block rounded-lg" />
            </div>
          </div>

          {/* Alias display */}
          <div className="text-center">
            <p className="text-lg font-semibold text-white">@{activeAlias}</p>
            <p className="mt-1 break-all text-xs text-zinc-500">{payUrl}</p>
          </div>

          {/* Copy + Share */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCopyLink}
              className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-150 active:scale-95 ${
                copied
                  ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                  : 'bg-white/10 text-white hover:bg-white/15'
              }`}
            >
              {copied ? (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
                  </svg>
                  Copy link
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: `Pay @${activeAlias}`, url: payUrl })
                }
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 active:scale-[0.97] hover:shadow-blue-500/40"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
