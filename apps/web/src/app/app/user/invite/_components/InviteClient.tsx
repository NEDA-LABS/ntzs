'use client'

import { useState } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'

interface InviteClientProps {
  code: string
  inviteUrl: string
}

const WHATSAPP_MSG = (url: string) =>
  `Hey! I'm using nTZS — Tanzania's digital shilling on Base. Join me and send money faster for less.\n\n${url}`

const TWITTER_MSG = (url: string) =>
  `I'm sending money with nTZS — Tanzania's first on-chain shilling. Fast, stable, and borderless. Join me 👇\n\n${url}`

export function InviteClient({ code, inviteUrl }: InviteClientProps) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  async function copy(text: string, which: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    } catch {}
  }

  async function nativeShare() {
    try {
      await navigator.share({
        title: 'Join me on nTZS',
        text: WHATSAPP_MSG(inviteUrl),
        url: inviteUrl,
      })
    } catch {}
  }

  const waHref = `https://wa.me/?text=${encodeURIComponent(WHATSAPP_MSG(inviteUrl))}`
  const twHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(TWITTER_MSG(inviteUrl))}`

  return (
    <div className="min-h-screen bg-[#070b14]">
      {/* ── Background glow ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-violet-600/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[320px] w-[320px] rounded-full bg-emerald-600/8 blur-[100px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-lg px-5 py-12 sm:px-8">

        {/* ── Hero text ── */}
        <div className="mb-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35">
            Invite &amp; Earn
          </p>
          <h1 className="mt-4 text-5xl font-thin leading-tight tracking-tight text-white sm:text-6xl">
            Share<br />
            <span className="font-black">nTZS.</span>
          </h1>
          <p className="mt-5 max-w-sm text-sm font-light leading-relaxed text-white/50">
            Invite friends to join Tanzania's digital payment network. Earnings unlock soon — for now, grow the community.
          </p>
        </div>

        {/* ── Invite link card ── */}
        <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur-2xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35 mb-4">
            Your invite link
          </p>

          {/* URL row */}
          <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/30 px-4 py-3.5">
            <p className="min-w-0 flex-1 truncate font-mono text-xs text-white/60">
              {inviteUrl}
            </p>
            <button
              type="button"
              onClick={() => copy(inviteUrl, 'link')}
              className="shrink-0 flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/70 transition-all hover:bg-white/[0.10] hover:text-white"
            >
              {copied === 'link' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>

          {/* Code row */}
          <div className="mt-3 flex items-center justify-between rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] px-4 py-3">
            <div>
              <p className="text-[10px] text-white/30">Referral code</p>
              <p className="mt-0.5 font-mono text-base font-bold tracking-widest text-violet-300">{code}</p>
            </div>
            <button
              type="button"
              onClick={() => copy(code, 'code')}
              className="flex items-center gap-1.5 rounded-full bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-300 ring-1 ring-violet-500/20 transition-all hover:bg-violet-500/25"
            >
              {copied === 'code' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === 'code' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {/* ── Share buttons ── */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-4 text-center text-xs font-medium text-white/60 transition-all hover:border-[#25D366]/30 hover:bg-[#25D366]/[0.06] hover:text-[#25D366]"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            WhatsApp
          </a>

          <a
            href={twHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-4 text-center text-xs font-medium text-white/60 transition-all hover:border-sky-400/30 hover:bg-sky-400/[0.06] hover:text-sky-400"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            X / Twitter
          </a>

          <button
            type="button"
            onClick={nativeShare}
            className="flex flex-col items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-4 text-xs font-medium text-white/60 transition-all hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
          >
            <Share2 className="h-5 w-5" />
            More
          </button>
        </div>

        {/* ── How it works ── */}
        <div className="mt-8 rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur-2xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">How it works</p>
          <div className="mt-5 space-y-5">
            {[
              { n: '01', title: 'Share your link', body: 'Send your unique invite link or referral code to friends and family.' },
              { n: '02', title: 'They sign up', body: 'Your friend creates an nTZS account using your link.' },
              { n: '03', title: 'Earnings coming soon', body: 'Reward tracking is on the way. Your referrals are being recorded.', dim: true },
            ].map(({ n, title, body, dim }) => (
              <div key={n} className="flex gap-4">
                <span className="mt-0.5 shrink-0 font-mono text-xs text-violet-500/50">{n}</span>
                <div>
                  <p className={`text-sm font-medium ${dim ? 'text-white/30' : 'text-white/80'}`}>{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/30">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Coming soon earn strip ── */}
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] px-5 py-4">
          <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-400/50" />
          <p className="text-xs text-white/40">
            Earn <span className="font-semibold text-emerald-400/70">5,000 TZS</span> per referral — reward payouts launching soon.
          </p>
        </div>

      </div>
    </div>
  )
}
