'use client'

import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
import {
  IconCheckCircle,
  IconChevronLeft,
  IconCopy,
  IconLink,
  IconPhone,
  IconCard,
  IconCoins,
  IconReceipt,
  IconZap,
  IconCollect,
} from '@/app/app/_components/icons'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ntzs.co.tz'
const QUICK_AMOUNTS = [1000, 5000, 10000, 50000]

type View = 'overview' | 'create' | 'success'

interface Collection {
  id: string
  amountTzs: number
  status: string
  payerName: string | null
  createdAt: string | null
}

interface Props {
  payAlias: string | null
  collections: Collection[]
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmt(n: number): string {
  return n.toLocaleString()
}

function stripProto(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^localhost:\d+/, 'ntzs.co.tz')
}

async function copyText(text: string, setter: (v: boolean) => void) {
  try {
    await navigator.clipboard.writeText(text)
    setter(true)
    setTimeout(() => setter(false), 2000)
  } catch {}
}

function openWhatsApp(url: string) {
  const msg = encodeURIComponent(`Pay me via nTZS:\n${url}`)
  window.open(`https://wa.me/?text=${msg}`, '_blank')
}

// ─── Method chip ───────────────────────────────────────────────────────────

function MethodChip({
  label,
  icon: Icon,
  active,
  onToggle,
}: {
  label: string
  icon: React.FC<React.SVGProps<SVGSVGElement>>
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition-all duration-150 active:scale-[0.97] ${
        active
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400 shadow-[0_0_0_1px_rgba(52,211,153,0.2)]'
          : 'border-border/40 bg-background/35 text-muted-foreground hover:border-border/60 hover:text-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

// ─── No-alias prompt ────────────────────────────────────────────────────────

function NoAliasPrompt() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/40 bg-card/60 backdrop-blur-2xl">
          <IconCollect className="h-7 w-7 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">Set up your payment handle</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Create your <span className="font-mono text-foreground/70">@handle</span> to start collecting payments from customers.
        </p>
        <Link
          href="/app/user/wallet"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          Set up now →
        </Link>
      </div>
    </div>
  )
}

// ─── Overview screen ────────────────────────────────────────────────────────

function OverviewScreen({
  payAlias,
  basePayUrl,
  collections,
  handleCopied,
  onCopyHandle,
  onShareWhatsApp,
  onCreateLink,
}: {
  payAlias: string
  basePayUrl: string
  collections: Collection[]
  handleCopied: boolean
  onCopyHandle: () => void
  onShareWhatsApp: () => void
  onCreateLink: () => void
}) {
  const totalMinted = collections
    .filter((c) => c.status === 'minted')
    .reduce((s, c) => s + c.amountTzs, 0)

  return (
    <div className="space-y-4">

      {/* ── Header card ── */}
      <div className="relative overflow-hidden rounded-[28px] border border-border/40 bg-card/70 p-6 shadow-[0_30px_90px_rgba(3,7,18,0.32)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(42,157,143,0.12),transparent_40%),radial-gradient(circle_at_90%_100%,rgba(96,165,250,0.10),transparent_50%)]" />

        <div className="relative">
          {/* Label row */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Collect Payments
            </span>
            <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Active</span>
            </div>
          </div>

          {/* Handle */}
          <div className="mt-4">
            <p className="font-mono text-3xl font-semibold leading-none text-foreground">
              @{payAlias}
            </p>
            <p className="mt-1.5 font-mono text-xs text-muted-foreground">
              {stripProto(basePayUrl)}
            </p>
          </div>

          <div className="mt-4 h-px bg-gradient-to-r from-foreground/20 via-foreground/10 to-transparent" />

          {/* CTAs */}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onCopyHandle}
              className={`flex flex-1 items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
                handleCopied
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                  : 'border-border/40 bg-background/35 text-foreground backdrop-blur-xl hover:bg-background/45'
              }`}
            >
              <IconCopy className="h-4 w-4" />
              {handleCopied ? 'Copied!' : 'Copy Link'}
            </button>
            <button
              type="button"
              onClick={onShareWhatsApp}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_20px_rgba(37,211,102,0.25)] transition-all duration-150 hover:bg-[#20bd5a] active:scale-[0.98]"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Share on WhatsApp
            </button>
          </div>

          {/* Total collected pill */}
          {totalMinted > 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-2.5">
              <IconCheckCircle className="h-4 w-4 text-emerald-400" />
              <span className="text-xs text-muted-foreground">Total collected</span>
              <span className="ml-auto font-mono text-sm font-semibold text-emerald-400">
                +{fmt(totalMinted)} TZS
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Action cards ── */}
      <div className="grid grid-cols-2 gap-3">
        {/* Create payment link */}
        <button
          type="button"
          onClick={onCreateLink}
          className="group relative overflow-hidden rounded-[24px] border border-border/40 bg-card/60 p-5 text-left backdrop-blur-2xl transition-all duration-200 hover:border-border/60 hover:bg-card/80 active:scale-[0.98]"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_100%,rgba(96,165,250,0.08),transparent_60%)] opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="relative">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl border border-border/40 bg-background/50">
              <IconLink className="h-4 w-4 text-blue-400" />
            </div>
            <p className="text-sm font-semibold text-foreground">Create Link</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Set amount & description</p>
            <div className="mt-4 flex items-center gap-1 text-[11px] font-medium text-blue-400">
              Generate <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </div>
          </div>
        </button>

        {/* Quick share */}
        <button
          type="button"
          onClick={onShareWhatsApp}
          className="group relative overflow-hidden rounded-[24px] border border-border/40 bg-card/60 p-5 text-left backdrop-blur-2xl transition-all duration-200 hover:border-border/60 hover:bg-card/80 active:scale-[0.98]"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_100%,rgba(37,211,102,0.06),transparent_60%)] opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="relative">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl border border-border/40 bg-background/50">
              <IconZap className="h-4 w-4 text-[#25D366]" />
            </div>
            <p className="text-sm font-semibold text-foreground">Quick Share</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Customer sets amount</p>
            <div className="mt-4 flex items-center gap-1 text-[11px] font-medium text-[#25D366]">
              Share now <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </div>
          </div>
        </button>
      </div>

      {/* ── Recent collections ── */}
      <div className="overflow-hidden rounded-[28px] border border-border/40 bg-card/60 backdrop-blur-2xl">
        <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Recent Collections</p>
            {collections.length > 0 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{collections.length} payments via your link</p>
            )}
          </div>
          {collections.length > 0 && (
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
              {collections.filter((c) => c.status === 'minted').length} received
            </span>
          )}
        </div>

        {collections.length === 0 ? (
          <div className="py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.04]">
              <IconReceipt className="h-5 w-5 text-zinc-600" />
            </div>
            <p className="mt-3 text-sm font-medium text-zinc-400">No collections yet</p>
            <p className="mt-1 text-xs text-zinc-600">Share your link to start receiving payments</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {collections.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                  <IconCollect className="h-3.5 w-3.5 text-emerald-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {c.payerName ?? 'Anonymous'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{relativeTime(c.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-semibold text-emerald-400">
                    +{fmt(c.amountTzs)} TZS
                  </p>
                  <p className={`text-[10px] font-medium capitalize ${
                    c.status === 'minted' ? 'text-emerald-400' :
                    c.status === 'rejected' || c.status === 'cancelled' ? 'text-rose-400' :
                    'text-amber-400'
                  }`}>
                    {c.status === 'minted' ? 'Received' : c.status.replace(/_/g, ' ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Create link screen ─────────────────────────────────────────────────────

function CreateLinkScreen({
  payAlias,
  amount,
  setAmount,
  description,
  setDescription,
  fixedAmount,
  setFixedAmount,
  methodMobile,
  setMethodMobile,
  methodCard,
  setMethodCard,
  methodNtzs,
  setMethodNtzs,
  onBack,
  onGenerate,
}: {
  payAlias: string
  amount: string
  setAmount: (v: string) => void
  description: string
  setDescription: (v: string) => void
  fixedAmount: boolean
  setFixedAmount: (v: boolean) => void
  methodMobile: boolean
  setMethodMobile: (v: boolean) => void
  methodCard: boolean
  setMethodCard: (v: boolean) => void
  methodNtzs: boolean
  setMethodNtzs: (v: boolean) => void
  onBack: () => void
  onGenerate: () => void
}) {
  const canGenerate = !fixedAmount || (!!amount && Number(amount) > 0)

  return (
    <div className="mx-auto max-w-lg">
      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <IconChevronLeft className="h-4 w-4" />
        Back
      </button>

      {/* Card */}
      <div className="relative overflow-hidden rounded-[28px] border border-border/40 bg-card/70 p-6 shadow-[0_30px_90px_rgba(3,7,18,0.32)] backdrop-blur-2xl md:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_0%,rgba(96,165,250,0.08),transparent_40%)]" />

        <div className="relative space-y-6">
          {/* Header */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Create Payment Link
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              for <span className="font-mono text-foreground/70">@{payAlias}</span>
            </p>
          </div>

          {/* Amount */}
          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">
              Amount (TZS)
            </label>
            <div className="flex items-center gap-2 rounded-2xl border border-border/40 bg-background/40 px-4 py-3 backdrop-blur-xl focus-within:border-blue-500/40 focus-within:ring-1 focus-within:ring-blue-500/20">
              <span className="text-sm font-medium text-muted-foreground">TZS</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={!fixedAmount}
                className="flex-1 bg-transparent text-2xl font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none disabled:opacity-40"
              />
            </div>
            <div className="mt-2.5 flex gap-2">
              {QUICK_AMOUNTS.map((qa) => (
                <button
                  key={qa}
                  type="button"
                  disabled={!fixedAmount}
                  onClick={() => setAmount(String(qa))}
                  className={`flex-1 rounded-xl border border-border/40 bg-background/35 py-1.5 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-30 ${
                    amount === String(qa)
                      ? 'border-blue-500/40 bg-blue-500/15 text-blue-400'
                      : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                  }`}
                >
                  {qa >= 1000 ? `${qa / 1000}k` : qa}
                </button>
              ))}
            </div>
          </div>

          {/* Fixed / open toggle */}
          <div>
            <label className="mb-2.5 block text-xs font-medium text-muted-foreground">
              Amount type
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFixedAmount(true)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-medium transition-all duration-150 ${
                  fixedAmount
                    ? 'border-blue-500/40 bg-blue-500/15 text-blue-400 shadow-[0_0_0_1px_rgba(96,165,250,0.2)]'
                    : 'border-border/40 bg-background/35 text-muted-foreground hover:border-border/60 hover:text-foreground'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${fixedAmount ? 'bg-blue-400' : 'bg-muted-foreground'}`} />
                Fixed Amount
              </button>
              <button
                type="button"
                onClick={() => setFixedAmount(false)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-medium transition-all duration-150 ${
                  !fixedAmount
                    ? 'border-violet-500/40 bg-violet-500/15 text-violet-400 shadow-[0_0_0_1px_rgba(139,92,246,0.2)]'
                    : 'border-border/40 bg-background/35 text-muted-foreground hover:border-border/60 hover:text-foreground'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${!fixedAmount ? 'bg-violet-400' : 'bg-muted-foreground'}`} />
                Customer sets amount
              </button>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">
              Description <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Groceries, School fees, Order #42"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={80}
              className="w-full rounded-2xl border border-border/40 bg-background/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 backdrop-blur-xl focus:border-blue-500/40 focus:outline-none focus:ring-1 focus:ring-blue-500/20"
            />
          </div>

          {/* Payment methods */}
          <div>
            <label className="mb-2.5 block text-xs font-medium text-muted-foreground">
              Accept via
            </label>
            <div className="flex flex-wrap gap-2">
              <MethodChip
                label="Mobile Money"
                icon={IconPhone}
                active={methodMobile}
                onToggle={() => setMethodMobile(!methodMobile)}
              />
              <MethodChip
                label="Card"
                icon={IconCard}
                active={methodCard}
                onToggle={() => setMethodCard(!methodCard)}
              />
              <MethodChip
                label="nTZS Wallet"
                icon={IconCoins}
                active={methodNtzs}
                onToggle={() => setMethodNtzs(!methodNtzs)}
              />
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground/60">
              Mobile Money is enabled by default. Card and nTZS coming soon.
            </p>
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-lg transition-all duration-75 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Generate Payment Link
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Success screen ──────────────────────────────────────────────────────────

function SuccessScreen({
  generatedLink,
  amount,
  description,
  linkCopied,
  onCopyLink,
  onShareWhatsApp,
  onCreateAnother,
  onBackToOverview,
}: {
  generatedLink: string
  amount: string
  description: string
  linkCopied: boolean
  onCopyLink: () => void
  onShareWhatsApp: () => void
  onCreateAnother: () => void
  onBackToOverview: () => void
}) {
  const displayUrl = stripProto(generatedLink)

  return (
    <div className="mx-auto max-w-md">
      {/* Back */}
      <button
        type="button"
        onClick={onBackToOverview}
        className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <IconChevronLeft className="h-4 w-4" />
        Back
      </button>

      {/* Card */}
      <div className="relative overflow-hidden rounded-[28px] border border-border/40 bg-card/70 p-8 shadow-[0_30px_90px_rgba(3,7,18,0.32)] backdrop-blur-2xl text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(42,157,143,0.14),transparent_50%)]" />

        <div className="relative">
          {/* Check icon */}
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/15 shadow-[0_0_30px_rgba(42,157,143,0.15)]">
            <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
            Link Ready
          </p>
          <h2 className="mt-2 text-xl font-semibold text-foreground">
            Your collect link is ready
          </h2>

          {(amount || description) && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {amount && Number(amount) > 0 && (
                <span className="rounded-full border border-border/40 bg-background/40 px-3 py-1 font-mono text-xs font-semibold text-foreground/80">
                  TZS {fmt(Number(amount))}
                </span>
              )}
              {description && (
                <span className="rounded-full border border-border/40 bg-background/40 px-3 py-1 text-xs text-muted-foreground">
                  {description}
                </span>
              )}
            </div>
          )}

          {/* Link display */}
          <div className="mt-5 rounded-2xl border border-border/40 bg-background/40 px-4 py-3.5 backdrop-blur-xl">
            <p className="break-all font-mono text-xs text-muted-foreground">{displayUrl}</p>
          </div>

          {/* Action buttons */}
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onCopyLink}
              className={`flex flex-1 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
                linkCopied
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                  : 'border-border/40 bg-background/35 text-foreground backdrop-blur-xl hover:bg-background/45'
              }`}
            >
              <IconCopy className="h-4 w-4" />
              {linkCopied ? 'Copied!' : 'Copy Link'}
            </button>
            <button
              type="button"
              onClick={onShareWhatsApp}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(37,211,102,0.2)] transition-all duration-150 hover:bg-[#20bd5a] active:scale-[0.98]"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              WhatsApp
            </button>
          </div>

          <button
            type="button"
            onClick={onCreateAnother}
            className="mt-3 w-full rounded-2xl border border-border/30 bg-background/20 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-background/35 hover:text-foreground/70"
          >
            Create another link
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export function CollectClient({ payAlias, collections }: Props) {
  const prefersReducedMotion = useReducedMotion()
  const [view, setView] = useState<View>('overview')

  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [fixedAmount, setFixedAmount] = useState(true)
  const [methodMobile, setMethodMobile] = useState(true)
  const [methodCard, setMethodCard] = useState(false)
  const [methodNtzs, setMethodNtzs] = useState(false)

  const [generatedLink, setGeneratedLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [handleCopied, setHandleCopied] = useState(false)

  const basePayUrl = payAlias ? `${APP_URL}/pay/${payAlias}` : ''

  function handleGenerate() {
    if (!payAlias) return
    let url = `${APP_URL}/pay/${payAlias}`
    const params = new URLSearchParams()
    if (fixedAmount && amount && Number(amount) > 0) {
      params.set('amount', amount)
      params.set('fixed', '1')
    }
    if (description.trim()) {
      params.set('desc', description.trim())
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
    setGeneratedLink(url)
    setView('success')
  }

  function resetCreate() {
    setAmount('')
    setDescription('')
    setFixedAmount(true)
    setMethodMobile(true)
    setMethodCard(false)
    setMethodNtzs(false)
    setGeneratedLink('')
  }

  const slideVariants = {
    enterRight: { opacity: 0, x: 28 },
    enterLeft: { opacity: 0, x: -28 },
    center: { opacity: 1, x: 0 },
    exitLeft: { opacity: 0, x: -28 },
    exitRight: { opacity: 0, x: 28 },
  }

  return (
    <div className="bg-[#0d0d14] min-h-screen px-4 pt-6 pb-24 lg:px-8 lg:pb-8">
      <AnimatePresence mode="wait" initial={false}>
        {view === 'overview' && (
          <motion.div
            key="overview"
            initial={prefersReducedMotion ? { opacity: 0 } : slideVariants.enterLeft}
            animate={slideVariants.center}
            exit={prefersReducedMotion ? { opacity: 0 } : slideVariants.exitLeft}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {!payAlias ? (
              <NoAliasPrompt />
            ) : (
              <OverviewScreen
                payAlias={payAlias}
                basePayUrl={basePayUrl}
                collections={collections}
                handleCopied={handleCopied}
                onCopyHandle={() => copyText(basePayUrl, setHandleCopied)}
                onShareWhatsApp={() => openWhatsApp(basePayUrl)}
                onCreateLink={() => setView('create')}
              />
            )}
          </motion.div>
        )}

        {view === 'create' && (
          <motion.div
            key="create"
            initial={prefersReducedMotion ? { opacity: 0 } : slideVariants.enterRight}
            animate={slideVariants.center}
            exit={prefersReducedMotion ? { opacity: 0 } : slideVariants.exitRight}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <CreateLinkScreen
              payAlias={payAlias ?? ''}
              amount={amount}
              setAmount={setAmount}
              description={description}
              setDescription={setDescription}
              fixedAmount={fixedAmount}
              setFixedAmount={setFixedAmount}
              methodMobile={methodMobile}
              setMethodMobile={setMethodMobile}
              methodCard={methodCard}
              setMethodCard={setMethodCard}
              methodNtzs={methodNtzs}
              setMethodNtzs={setMethodNtzs}
              onBack={() => setView('overview')}
              onGenerate={handleGenerate}
            />
          </motion.div>
        )}

        {view === 'success' && (
          <motion.div
            key="success"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <SuccessScreen
              generatedLink={generatedLink}
              amount={amount}
              description={description}
              linkCopied={linkCopied}
              onCopyLink={() => copyText(generatedLink, setLinkCopied)}
              onShareWhatsApp={() => openWhatsApp(generatedLink)}
              onCreateAnother={() => { resetCreate(); setView('create') }}
              onBackToOverview={() => { resetCreate(); setView('overview') }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
