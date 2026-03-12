"use client"

import { useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Sparkles, Wallet, TrendingUp, ArrowUpDown, PiggyBank, Newspaper, BarChart3, Send, Loader2 } from "lucide-react"
import RadialOrbitalTimeline, { type TimelineItem } from "@/components/ui/radial-orbital-timeline"

interface AIOrbitProps {
  walletBalance: number
  savingsBalance?: number
  savingsYieldEarned?: number
  savingsRatePercent?: number
  recentTxCount?: number
  lastTxAmountTzs?: number
}

export function AIOrbit({
  walletBalance,
  savingsBalance = 0,
  savingsYieldEarned = 0,
  savingsRatePercent = 0,
  recentTxCount = 0,
  lastTxAmountTzs = 0,
}: AIOrbitProps) {

  const walletEnergy = Math.min(100, Math.max(5, Math.floor((walletBalance / 500_000) * 100)))
  const savingsEnergy = savingsBalance > 0 ? Math.min(100, Math.max(10, Math.floor((savingsBalance / 1_000_000) * 100))) : 8
  const txEnergy = Math.min(100, recentTxCount * 20)

  const timelineData: TimelineItem[] = [
    {
      id: 1,
      title: "Wallet",
      date: `${walletBalance.toLocaleString()} TZS`,
      content: `Your current wallet balance is ${walletBalance.toLocaleString()} TZS. ${walletBalance > 0 ? "Funds are available to send or save." : "Deposit TZS to get started."}`,
      category: "Balance",
      icon: Wallet,
      relatedIds: [2, 3, 5],
      status: walletBalance > 0 ? "completed" : "pending",
      energy: walletEnergy,
      actionLabel: walletBalance > 0 ? "Send TZS" : "Deposit",
      actionHref: walletBalance > 0 ? "/app/user/send" : "/app/user/deposit",
      accentColor: "blue",
    },
    {
      id: 2,
      title: "Savings",
      date: savingsRatePercent > 0 ? `${savingsRatePercent}% p.a.` : "–",
      content: savingsBalance > 0
        ? `You have ${savingsBalance.toLocaleString()} TZS saved, earning ${savingsYieldEarned.toLocaleString()} TZS in yield so far.`
        : `Start saving to earn ${savingsRatePercent > 0 ? `${savingsRatePercent}% annually` : "yield"} on your TZS. No lock-up period.`,
      category: "Savings",
      icon: PiggyBank,
      relatedIds: [1, 4],
      status: savingsBalance > 0 ? "in-progress" : "pending",
      energy: savingsEnergy,
      actionLabel: savingsBalance > 0 ? "Add Funds" : "Start Saving",
      actionHref: "/app/user/stake",
      accentColor: "violet",
    },
    {
      id: 3,
      title: "Activity",
      date: `${recentTxCount} recent`,
      content: recentTxCount > 0
        ? `You have ${recentTxCount} recent transaction${recentTxCount !== 1 ? "s" : ""}${lastTxAmountTzs > 0 ? `. Last: ${lastTxAmountTzs.toLocaleString()} TZS` : ""}.`
        : "No recent transactions. Send or receive TZS to see your activity here.",
      category: "Transactions",
      icon: ArrowUpDown,
      relatedIds: [1, 5],
      status: recentTxCount > 0 ? "completed" : "pending",
      energy: txEnergy || 5,
      actionLabel: "View all",
      actionHref: "/app/user/transactions",
      accentColor: "emerald",
    },
    {
      id: 4,
      title: "Yield",
      date: savingsYieldEarned > 0 ? `+${savingsYieldEarned.toLocaleString()}` : "0 TZS",
      content: savingsYieldEarned > 0
        ? `You have earned ${savingsYieldEarned.toLocaleString()} TZS in yield. Yield accrues daily and is paid on withdrawal.`
        : "Yield will appear here once your savings position accrues interest. It compounds daily.",
      category: "Yield",
      icon: TrendingUp,
      relatedIds: [2],
      status: savingsYieldEarned > 0 ? "in-progress" : "pending",
      energy: savingsYieldEarned > 0 ? Math.min(100, Math.floor((savingsYieldEarned / 10_000) * 100) + 20) : 5,
      actionLabel: "Withdraw yield",
      actionHref: "/app/user/stake",
      accentColor: "emerald",
    },
    {
      id: 5,
      title: "News",
      date: "TZ · DSE · TSL",
      content: "Stay up to date with Tanzania financial news from The Citizen, Dar es Salaam Stock Exchange, and Tanzania Securities Limited.",
      category: "News",
      icon: Newspaper,
      relatedIds: [6, 3],
      status: "completed",
      energy: 60,
      actionLabel: "Read The Citizen",
      actionHref: "https://www.thecitizen.co.tz/tanzania/news/national",
      accentColor: "blue",
    },
    {
      id: 6,
      title: "Markets",
      date: "DSE · TSL",
      content: "View live market data from the Dar es Salaam Stock Exchange and Tanzania Securities Limited.",
      category: "Markets",
      icon: BarChart3,
      relatedIds: [2, 4],
      status: "completed",
      energy: 70,
      actionLabel: "Open markets",
      actionHref: "https://dse.co.tz/",
      accentColor: "violet",
    },
  ]

  const [input, setInput] = useState("")
  const [reply, setReply] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    setInput("")
    setLoading(true)
    setReply(null)
    try {
      const res = await fetch("/api/v1/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: text }],
          context: { walletBalance, savingsBalance, recentTxCount },
        }),
      })
      const data = await res.json() as { message: string }
      setReply(data.message)
    } catch {
      setReply("Could not reach the AI assistant. Please try again.")
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="mt-5">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
            AI Assistant
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-violet-400/80">
            Online
          </span>
        </div>
      </div>

      <p className="mb-1 px-0.5 text-[11px] text-zinc-700">
        Tap any node to explore your account
      </p>

      {/* Orbital */}
      <RadialOrbitalTimeline timelineData={timelineData} />

      {/* AI reply bubble */}
      <AnimatePresence>
        {(reply || loading) && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            className="mx-1 mb-3 rounded-2xl border border-violet-500/20 bg-violet-500/[0.07] px-4 py-3"
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                <span className="text-xs text-white/50">Thinking...</span>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-white/80">{reply}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat input */}
      <form onSubmit={handleChat} className="mx-1">
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-zinc-900/80 px-4 py-2.5 backdrop-blur-xl focus-within:border-violet-500/40 transition-colors">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-400/60" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me anything..."
            disabled={loading}
            className="flex-1 bg-transparent text-sm text-white placeholder-white/25 outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 text-white transition-all active:scale-95 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </div>
  )
}
