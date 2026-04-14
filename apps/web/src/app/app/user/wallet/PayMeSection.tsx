'use client'

import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from 'framer-motion'

import { updatePayAlias } from './actions'
import { BalanceToggle } from '../_components/BalanceToggle'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

interface PayMeSectionProps {
  currentAlias: string | null
  suggestedAlias: string
  walletAddress: string
}

export function PayMeSection({ currentAlias, suggestedAlias, walletAddress }: PayMeSectionProps) {
  const [alias, setAlias] = useState(currentAlias ?? '')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()

  const activeAlias = currentAlias ?? ''
  const payUrl = activeAlias ? `${APP_URL}/pay/${activeAlias}` : ''
  const qrUrl = payUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&format=svg&data=${encodeURIComponent(payUrl)}`
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

  function handleShare(e: React.MouseEvent) {
    e.stopPropagation()
    if (!payUrl) return
    if (navigator.share) {
      navigator.share({ title: `Pay @${activeAlias}`, url: payUrl }).catch(() => {})
    } else {
      window.open(payUrl, '_blank')
    }
  }

  const expandedHeight = editing ? 280 : activeAlias ? 440 : 280

  // Open QR via TopActions event
  useEffect(() => {
    const onOpen = () => {
      if (activeAlias) {
        setQrOpen(true)
      } else {
        setIsExpanded(true)
        setEditing(true)
      }
    }
    window.addEventListener('wallet:openReceive', onOpen)
    return () => window.removeEventListener('wallet:openReceive', onOpen)
  }, [])

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
        className="relative overflow-hidden rounded-[32px] border border-border/40 bg-card/70 shadow-[0_30px_90px_rgba(3,7,18,0.32)] backdrop-blur-2xl"
        style={{
          rotateX: prefersReducedMotion ? 0 : springRotateX,
          rotateY: prefersReducedMotion ? 0 : springRotateY,
          transformStyle: 'preserve-3d',
        }}
        animate={{ height: isExpanded ? expandedHeight : 210 }}
        transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 32 }}
      >
        {/* Background radial gradients */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(255,255,255,0.08),transparent_34%),radial-gradient(circle_at_85%_100%,rgba(96,165,250,0.14),transparent_48%)]" />

        <motion.div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_35%,rgba(255,255,255,0.08)_50%,transparent_65%)]"
          animate={prefersReducedMotion ? undefined : { opacity: isHovered ? 1 : 0 }}
          style={prefersReducedMotion ? { opacity: 0 } : undefined}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.3 }}
        />

        <div className="relative z-10 flex h-full flex-col p-6">

          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Pay Me
            </span>
            <div className="flex items-center gap-1.5 rounded-full border border-border/40 bg-background/40 px-2.5 py-1 backdrop-blur">
              <span className={`h-1.5 w-1.5 rounded-full bg-emerald-400 ${prefersReducedMotion ? '' : 'animate-pulse'}`} />
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Link
              </span>
            </div>
          </div>

          <motion.div
            className="mt-auto"
            animate={{ y: prefersReducedMotion ? 0 : (isExpanded ? -4 : 0) }}
            transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 30 }}
          >
            {activeAlias ? (
              <>
                <div className="flex items-end gap-1">
                  <motion.span
                    className="font-semibold leading-none text-foreground"
                    style={{ fontSize: isExpanded ? '1.75rem' : '2.75rem' }}
                    animate={prefersReducedMotion ? undefined : { fontSize: isExpanded ? '1.75rem' : '2.75rem' }}
                    transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 30 }}
                  >
                    @{activeAlias}
                  </motion.span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">Share your payment link</div>
              </>
            ) : (
              <>
                <div className="text-3xl font-semibold leading-none text-foreground/70">Set up link</div>
                <div className="mt-1 text-sm text-muted-foreground">Get paid by anyone, anywhere</div>
              </>
            )}

            <motion.div
              className="mt-3 h-px bg-gradient-to-r from-foreground/60 via-foreground/20 to-transparent"
              animate={prefersReducedMotion ? { scaleX: 1, originX: 0 } : { scaleX: isHovered || isExpanded ? 1 : 0.2, originX: 0 }}
              transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.4, ease: 'easeOut' }}
            />
          </motion.div>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                className="mt-5 space-y-3"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: prefersReducedMotion ? 0 : 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.22, delay: 0.04 }}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
              >
                {/* Balance inside reveal */}
                <div className="rounded-[24px] border border-border/40 bg-background/40 p-4 backdrop-blur-xl">
                  <BalanceToggle walletAddress={walletAddress} />
                </div>

                {editing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        Your pay alias
                      </label>
                      <div className="flex items-center gap-2 rounded-2xl border border-border/40 bg-background/35 px-3 py-2.5 backdrop-blur-xl">
                        <span className="text-sm text-muted-foreground">@</span>
                        <input
                          type="text"
                          value={alias}
                          onChange={(e) =>
                            setAlias(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))
                          }
                          placeholder={suggestedAlias}
                          maxLength={30}
                          autoFocus
                          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground/80">
                        3–30 characters · letters, numbers, - or _
                      </p>
                    </div>

                    {error && (
                      <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-500/20">
                        {error}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity duration-75 disabled:opacity-70 active:scale-[0.98] hover:opacity-90"
                      >
                        {saving ? 'Saving...' : 'Save alias'}
                      </button>
                      {currentAlias && (
                        <button
                          type="button"
                          onClick={() => { setEditing(false); setError('') }}
                          className="rounded-full border border-border/40 bg-background/35 px-4 py-3 text-sm font-medium text-muted-foreground backdrop-blur-xl hover:bg-background/45"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-[11px] text-muted-foreground">{payUrl}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setQrOpen(true) }}
                          className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus:ring-2 focus:ring-ring"
                        >
                          Show QR & Share
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyLink}
                          className={`rounded-2xl px-4 py-2.5 text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
                            copied
                              ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                              : 'border border-border/40 bg-background/35 text-foreground backdrop-blur-xl hover:bg-background/45'
                          }`}
                        >
                          {copied ? 'Copied' : 'Copy link'}
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setEditing(true) }}
                      className="w-full rounded-2xl border border-border/30 bg-background/20 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-background/35 hover:text-foreground/70"
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
        className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground"
        animate={prefersReducedMotion ? { opacity: isHovered && !isExpanded ? 1 : 0 } : { opacity: isHovered && !isExpanded ? 1 : 0, y: isHovered ? 0 : 4 }}
        transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.2 }}
      >
        Tap to reveal QR
      </motion.p>

      {/* QR + Share Modal */}
      {qrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setQrOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-border/50 bg-card/90 p-5 shadow-2xl backdrop-blur-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground">Pay @{activeAlias}</div>
              <button onClick={() => setQrOpen(false)} className="rounded-lg border border-border/40 bg-background/35 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring">Close</button>
            </div>
            <div className="flex justify-center">
              <div className="rounded-2xl border border-border/40 bg-background/50 p-3 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
                <img src={qrUrl} alt="Pay QR" width={240} height={240} className="block rounded-xl" />
              </div>
            </div>
            <p className="mt-3 break-all text-center text-[11px] text-muted-foreground">{payUrl}</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleCopyLink}
                className={`flex-1 rounded-2xl px-4 py-2.5 text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
                  copied
                    ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'border border-border/40 bg-background/35 text-foreground backdrop-blur-xl hover:bg-background/45'
                }`}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="flex-1 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus:ring-2 focus:ring-ring"
              >
                Share
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
