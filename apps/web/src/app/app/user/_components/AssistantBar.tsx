"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

import { GlassInput } from "@/components/ui/glass-input"

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

  const sendMatch = s.match(/send\s+([0-9]+(?:[.,][0-9]+)?)\s*(?:tzs|ntzs)?\s*(?:to)?\s*(@[a-z0-9_-]+|0x[a-f0-9]{6,})?/)
  if (sendMatch) {
    const amount = sendMatch[1]?.replace(",", ".")
    const to = sendMatch[2]
    return { type: "send", amount, to }
  }

  const swapMatch = s.match(/swap\s+([0-9]+(?:[.,][0-9]+)?)\s*(usdc|tzs)?\s*(?:to|→)\s*(usdc|tzs)/)
  if (swapMatch) {
    const amount = swapMatch[1]?.replace(",", ".")
    const from = (swapMatch[2] || "tzs").toUpperCase() as "TZS" | "USDC"
    const toSym = swapMatch[3].toUpperCase() as "TZS" | "USDC"
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
    go(parseIntent(value))
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
            className="rounded-full border border-border/40 bg-background/35 px-3 py-1.5 text-xs font-medium text-foreground/80 backdrop-blur-xl transition-colors hover:bg-background/45 focus-visible:outline-none focus:ring-2 focus:ring-ring"
          >
            {chip.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
