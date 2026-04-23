'use client'

import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'

interface Props {
  code: string
  inviteUrl: string
}

const COPY_DURATION = 2000

export function InviteClient({ code, inviteUrl }: Props) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), COPY_DURATION)
    } catch {}
  }

  const waHref = `https://wa.me/?text=${encodeURIComponent(
    `Join me on nTZS — send money across Tanzania instantly.\n${inviteUrl}`
  )}`

  const twHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    `Tanzania's digital shilling is here. Send money like a text message with nTZS 🇹🇿\n${inviteUrl}`
  )}`

  return (
    <div className="min-h-screen bg-[#070b14] text-white">

      {/* ── Hero section ── */}
      <div className="relative overflow-hidden">
        {/* Large faded ticker as background art */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.04]">
          <img src="/ntzs-icon.svg" alt="" className="h-[480px] w-[480px]" />
        </div>
        {/* Radial glow */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(139,92,246,0.14),transparent)]" />

        <div className="relative px-5 pb-8 pt-14 text-center sm:px-8">
          {/* Ticker badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 backdrop-blur">
            <img src="/ntzs-icon.svg" alt="nTZS" className="h-5 w-5" />
            <span className="text-xs font-semibold tracking-widest text-white/60 uppercase">nTZS</span>
          </div>

          <h1 className="text-4xl font-thin tracking-tight text-white sm:text-5xl">
            Digital money.<br />
            <span className="font-black">Share it.</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xs text-sm font-light leading-relaxed text-white/45">
            Invite friends to the future of payments in Tanzania. Fast, stable, and borderless.
          </p>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="mx-auto max-w-md px-5 pb-16 sm:px-8">

        {/* ── Share card ── */}
        <div className="overflow-hidden rounded-[28px] border border-white/[0.08] bg-white/[0.03] backdrop-blur-2xl">

          {/* Visual header strip */}
          <div className="relative flex items-center gap-4 border-b border-white/[0.06] bg-gradient-to-r from-violet-500/10 via-transparent to-blue-500/10 px-6 py-5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/40">
              <img src="/ntzs-icon.svg" alt="nTZS" className="h-8 w-8" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">Your invite</p>
              <p className="mt-0.5 font-mono text-sm font-bold tracking-widest text-violet-300">{code}</p>
            </div>
            {/* USDC coin accent */}
            <img
              src="/usdc.png"
              alt=""
              className="absolute right-5 top-1/2 h-10 w-10 -translate-y-1/2 opacity-20"
            />
          </div>

          {/* Link row */}
          <div className="px-6 py-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
              Invite link
            </p>
            <div className="flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-black/30 p-1 pl-4">
              <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/40">
                {inviteUrl}
              </p>
              <button
                type="button"
                onClick={copy}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${
                  copied
                    ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'bg-white text-black hover:bg-white/90'
                }`}
              >
                {copied
                  ? <><Check className="h-3.5 w-3.5" /> Copied</>
                  : <><Copy className="h-3.5 w-3.5" /> Copy</>
                }
              </button>
            </div>
          </div>

          {/* Share row */}
          <div className="border-t border-white/[0.06] px-6 py-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
              Share on
            </p>
            <div className="flex gap-3">
              {/* WhatsApp */}
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-[#25D366]/20 bg-[#25D366]/[0.07] py-3 text-sm font-semibold text-[#25D366] transition-all hover:bg-[#25D366]/[0.14]"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                WhatsApp
              </a>

              {/* X */}
              <a
                href={twHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] py-3 text-sm font-semibold text-white/70 transition-all hover:bg-white/[0.08] hover:text-white"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                Post on X
              </a>
            </div>
          </div>
        </div>

        {/* ── Simple steps ── */}
        <div className="mt-6 space-y-px overflow-hidden rounded-[24px] border border-white/[0.06]">
          {[
            {
              icon: '/ntzs-icon.svg',
              step: '01',
              title: 'Share your link',
              body: 'Send your unique link via WhatsApp, X, or copy it anywhere.',
            },
            {
              icon: '/ntzs-icon.svg',
              step: '02',
              title: 'Friend signs up',
              body: 'They join nTZS and get access to instant, low-cost digital payments.',
            },
            {
              icon: '/usdc.png',
              step: '03',
              title: 'Earn together — coming soon',
              body: 'Reward tracking is on the way. Every referral is recorded.',
              dim: true,
            },
          ].map(({ icon, step, title, body, dim }) => (
            <div
              key={step}
              className={`flex items-start gap-4 bg-white/[0.02] px-6 py-5 ${dim ? 'opacity-40' : ''}`}
            >
              <img src={icon} alt="" className="mt-0.5 h-6 w-6 shrink-0 opacity-60" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-white/25">{step}</span>
                  <p className="text-sm font-semibold text-white/80">{title}</p>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-white/35">{body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Earn teaser strip ── */}
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400/60" />
            <p className="text-xs text-white/40">
              Earn <span className="font-bold text-emerald-400/80">5,000 TZS</span> per referral
            </p>
          </div>
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-400/60">
            Soon
          </span>
        </div>

      </div>
    </div>
  )
}
