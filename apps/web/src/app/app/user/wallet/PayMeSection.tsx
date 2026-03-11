'use client'

import type React from 'react'
import { useRef, useState } from 'react'
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion'

import { updatePayAlias } from './actions'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

interface PayMeSectionProps {
  currentAlias: string | null
  suggestedAlias: string
}

export function PayMeSection({ currentAlias, suggestedAlias }: PayMeSectionProps) {
  const [alias, setAlias] = useState(currentAlias ?? '')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const activeAlias = currentAlias ?? ''
  const payUrl = activeAlias ? `${APP_URL}/pay/${activeAlias}` : ''
  const qrUrl = payUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(payUrl)}`
    : ''

  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)
  const rotateX = useTransform(mouseY, [-60, 60], [6, -6])
  const rotateY = useTransform(mouseX, [-60, 60], [-6, 6])
  const springRotateX = useSpring(rotateX, { stiffness: 300, damping: 30 })
  const springRotateY = useSpring(rotateY, { stiffness: 300, damping: 30 })

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    mouseX.set(e.clientX - (rect.left + rect.width / 2))
    mouseY.set(e.clientY - (rect.top + rect.height / 2))
  }

  const handleMouseLeave = () => {
    mouseX.set(0)
    mouseY.set(0)
    setIsHovered(false)
  }

  const handleCardClick = () => {
    if (editing) return
    if (!activeAlias) {
      setIsExpanded(true)
      setEditing(true)
      return
    }
    setIsExpanded((v) => !v)
  }

  async function handleSave() {
    setError('')
    const value = alias.trim().toLowerCase()
    if (!value) { setError('Enter an alias'); return }
    setSaving(true)
    const fd = new FormData()
    fd.set('alias', value)
    const result = await updatePayAlias(fd)
    setSaving(false)
    if (result.success) {
      setAlias(result.alias)
      setEditing(false)
      window.location.reload()
    } else {
      setError(result.error)
    }
  }

  async function handleCopyLink(e: React.MouseEvent) {
    e.stopPropagation()
    if (!payUrl) return
    await navigator.clipboard.writeText(payUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const expandedHeight = editing ? 280 : activeAlias ? 440 : 280

  return (
    <motion.div
      ref={containerRef}
      className="relative cursor-pointer select-none"
      style={{ perspective: 1200 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onClick={handleCardClick}
    >
      <motion.div
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl"
        style={{
          rotateX: springRotateX,
          rotateY: springRotateY,
          transformStyle: 'preserve-3d',
        }}
        animate={{ height: isExpanded ? expandedHeight : 210 }}
        transition={{ type: 'spring', stiffness: 350, damping: 32 }}
      >
        {/* Background radial gradients */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(0,112,243,0.18),transparent_50%),radial-gradient(circle_at_85%_100%,rgba(139,92,246,0.12),transparent_55%)]" />

        {/* Hover shimmer */}
        <motion.div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_35%,rgba(255,255,255,0.04)_50%,transparent_65%)]"
          animate={{ opacity: isHovered ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        />

        <div className="relative z-10 flex h-full flex-col p-6">

          {/* Header row */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-400/80">
              Pay Me
            </span>
            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
              <span className="text-[10px] font-medium uppercase tracking-widest text-white/40">
                Link
              </span>
            </div>
          </div>

          {/* Alias / placeholder block */}
          <motion.div
            className="mt-auto"
            animate={{ y: isExpanded ? -4 : 0 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
          >
            {activeAlias ? (
              <>
                <div className="flex items-end gap-1">
                  <motion.span
                    className="font-bold leading-none text-white"
                    animate={{ fontSize: isExpanded ? '1.75rem' : '2.75rem' }}
                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  >
                    @{activeAlias}
                  </motion.span>
                </div>
                <div className="mt-1 text-sm text-white/35">Share your payment link</div>
              </>
            ) : (
              <>
                <div className="text-3xl font-bold leading-none text-white/30">Set up link</div>
                <div className="mt-1 text-sm text-white/25">Get paid by anyone, anywhere</div>
              </>
            )}

            {/* Animated underline */}
            <motion.div
              className="mt-3 h-px bg-gradient-to-r from-blue-500/60 via-violet-400/30 to-transparent"
              animate={{ scaleX: isHovered || isExpanded ? 1 : 0.2, originX: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </motion.div>

          {/* Expanded panel */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                className="mt-5 space-y-3"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.22, delay: 0.04 }}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
              >
                {editing ? (
                  /* Alias editor */
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-white/40">
                        Your pay alias
                      </label>
                      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-2.5">
                        <span className="text-sm text-white/30">@</span>
                        <input
                          type="text"
                          value={alias}
                          onChange={(e) =>
                            setAlias(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))
                          }
                          placeholder={suggestedAlias}
                          maxLength={30}
                          autoFocus
                          className="flex-1 bg-transparent text-sm text-white placeholder:text-white/20 focus:outline-none"
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-white/20">
                        3–30 characters · letters, numbers, - or _
                      </p>
                    </div>

                    {error && (
                      <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                        {error}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 disabled:opacity-70 active:scale-[0.98] hover:shadow-blue-500/40"
                      >
                        {saving ? 'Saving...' : 'Save alias'}
                      </button>
                      {currentAlias && (
                        <button
                          type="button"
                          onClick={() => { setEditing(false); setError('') }}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white/60 hover:bg-white/10"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* QR + actions */
                  <>
                    <div className="flex justify-center">
                      <div className="rounded-2xl bg-white p-3 shadow-lg shadow-black/40">
                        <img
                          src={qrUrl}
                          alt="Pay Me QR"
                          width={180}
                          height={180}
                          className="block rounded-lg"
                        />
                      </div>
                    </div>

                    <p className="text-center text-[11px] break-all text-white/25">{payUrl}</p>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        className={`flex-1 inline-flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
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
                        onClick={(e) => {
                          e.stopPropagation()
                          if (navigator.share) navigator.share({ title: `Pay @${activeAlias}`, url: payUrl })
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 active:scale-[0.97] hover:shadow-blue-500/40"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                        Share
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setEditing(true) }}
                      className="w-full rounded-2xl border border-white/5 bg-white/[0.03] py-2.5 text-xs font-medium text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/50"
                    >
                      Edit alias
                    </button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Tap hint */}
      <motion.p
        className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-white/25"
        animate={{ opacity: isHovered && !isExpanded ? 1 : 0, y: isHovered ? 0 : 4 }}
        transition={{ duration: 0.2 }}
      >
        Tap to reveal QR
      </motion.p>
    </motion.div>
  )
}
