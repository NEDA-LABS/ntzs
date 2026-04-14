"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

import { GlassInput } from "@/components/ui/glass-input"
import { track } from "@/lib/telemetry"

type Intent =
  | { type: "receive" }
  | { type: "send"; to?: string; amount?: string }
  | { type: "swap"; amount?: string; from?: "TZS" | "USDC"; toSym?: "TZS" | "USDC" }
  | { type: "deposit" }
  | { type: "stake" }
  | { type: "activity" }
  | { type: "wallet" }

function parseIntent(input: string): Intent | null {
  const s = input.trim().toLowerCase()
  if (!s) return null

  if (/^(receive|pay(\s+link)?)\b/.test(s)) return { type: "receive" }

  // Normalize amounts like 25k, 1.5m
  const toNumber = (t?: string) => {
    if (!t) return undefined
    const m = t.match(/([0-9]+(?:[.,][0-9]+)?)([km])?/)
    if (!m) return undefined
    const base = parseFloat(m[1].replace(",", "."))
    const suf = m[2]
    if (!Number.isFinite(base)) return undefined
    if (suf === 'k') return String(base * 1_000)
    if (suf === 'm') return String(base * 1_000_000)
    return String(base)
  }

  // send <amt> [tzs] to <recipient> | send to <recipient> <amt>
  const sendMatch = s.match(/send\s+(?:(?:to\s+)?(@[a-z0-9_-]+|0x[a-f0-9]{6,})\s+([0-9]+(?:[.,][0-9]+)?[km]?))|([0-9]+(?:[.,][0-9]+)?[km]?)\s*(?:tzs|ntzs)?\s*(?:to)?\s*(@[a-z0-9_-]+|0x[a-f0-9]{6,})/)
  if (sendMatch) {
    const to = sendMatch[1] || sendMatch[4]
    const amountRaw = sendMatch[2] || sendMatch[3]
    const amount = toNumber(amountRaw)
    return { type: "send", amount, to }
  }

  // swap <amt> [usdc|tzs] to <usdc|tzs> | swap to usdc <amt>
  const swapMatch = s.match(/swap\s+(?:(?:to\s*(usdc|tzs)\s*([0-9]+(?:[.,][0-9]+)?[km]?))|([0-9]+(?:[.,][0-9]+)?[km]?)\s*(usdc|tzs)?\s*(?:to|→)\s*(usdc|tzs))/)
  if (swapMatch) {
    const altTo = swapMatch[1]
    const altAmt = swapMatch[2]
    const stdAmt = swapMatch[3]
    const stdFrom = swapMatch[4]
    const stdTo = swapMatch[5]
    const amount = toNumber(altAmt || stdAmt)
    const from = ((stdFrom || (altTo === 'usdc' ? 'tzs' : 'usdc')) || 'tzs').toUpperCase() as "TZS" | "USDC"
    const toSym = ((stdTo || altTo) || 'usdc').toUpperCase() as "TZS" | "USDC"
    return { type: "swap", amount, from, toSym }
  }

  if (/^deposit\b/.test(s)) return { type: "deposit" }
  if (/^stake\b/.test(s)) return { type: "stake" }
  if (/^activity\b/.test(s)) return { type: "activity" }
  if (/^wallet\b/.test(s)) return { type: "wallet" }

  return null
}

export function AssistantBar() {
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC")
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function go(intent: Intent | null) {
    if (!intent) return
    switch (intent.type) {
      case "receive":
        window.location.href = "/app/user/wallet#receive"
        break
      case "send":
        window.location.href = "/app/user/wallet#send"
        break
      case "swap":
        window.location.href = "/app/user/wallet#swap"
        break
      case "deposit":
        window.location.href = "/app/user/deposits/new"
        break
      case "stake":
        window.location.href = "/app/user/stake"
        break
      case "activity":
        window.location.href = "/app/user/activity"
        break
      case "wallet":
        window.location.href = "/app/user/wallet"
        break
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const intent = parseIntent(value)
    track('assistant_submit', { value, intent })
    go(intent)
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="relative">
        <GlassInput
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Try: Send 25,000 TZS to @alex"
          className="h-12 pr-12"
        />
        <button
          type="submit"
          className="absolute right-1.5 top-1.5 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/40 bg-background/35 backdrop-blur-xl text-foreground/80 hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Submit"
        >
          <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {[
          { label: "Receive", href: "/app/user/wallet#receive" },
          { label: "Send", href: "/app/user/wallet#send" },
          { label: "Swap", href: "/app/user/wallet#swap" },
          { label: "Deposit", href: "/app/user/deposits/new" },
          { label: "Stake", href: "/app/user/stake" },
          { label: "Activity", href: "/app/user/activity" },
        ].map((chip) => (
          <Link
            key={chip.label}
            href={chip.href}
            prefetch
            onClick={() => track('assistant_chip_click', { label: chip.label, href: chip.href })}
            className="rounded-full border border-border/40 bg-background/35 px-3 py-1.5 text-xs font-medium text-foreground/80 backdrop-blur-xl transition-colors hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring"
          >
            {chip.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
