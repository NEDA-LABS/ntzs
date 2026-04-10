"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Sparkles,
  Wallet,
  TrendingUp,
  ArrowUpDown,
  PiggyBank,
  Newspaper,
  BarChart3,
  MessageSquare,
  CornerRightUp,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Play,
  Mic,
  MicOff,
} from "lucide-react"
import RadialOrbitalTimeline, { type TimelineItem } from "@/components/ui/radial-orbital-timeline"

interface AIOrbitProps {
  walletBalance: number
  savingsBalance?: number
  savingsYieldEarned?: number
  savingsRatePercent?: number
  recentTxCount?: number
  lastTxAmountTzs?: number
}

type SwapToken = "NTZS" | "USDC"

type InsightKey =
  | "balance"
  | "spent_today"
  | "spent_all_time"
  | "deposited_today"
  | "deposited_all_time"
  | "activity_today"

type AnalyticsContext = {
  walletBalanceTzs: number
  walletBalanceSource: "onchain" | "estimated"
  spentTodayTzs: number
  spentAllTimeTzs: number
  depositedTodayTzs: number
  depositedAllTimeTzs: number
  swapVolumeTodayTzsApprox: number
  swapVolumeAllTimeTzsApprox: number
  activityCountToday: number
  activityCountAllTime: number
  todayStartUtc: string
  updatedAt: string
}

type ExecutionPlan = {
  kind: "swap" | "send" | "deposit" | "withdraw" | "save" | "activity" | "news" | "markets" | "insight" | "unknown"
  title: string
  summary: string
  actionLabel: string
  actionHref?: string
  amount?: number
  recipient?: string
  fromToken?: SwapToken
  toToken?: SwapToken
  insightKey?: InsightKey
  confidence: number
}

type ExecutionStatus = "idle" | "ready" | "running" | "success" | "failed"

type SpeechRecognitionAlternativeLike = {
  transcript: string
}

type SpeechRecognitionResultLike = {
  0: SpeechRecognitionAlternativeLike
  isFinal: boolean
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

type SpeechRecognitionErrorEventLike = {
  error?: string
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function parseIntent(raw: string): ExecutionPlan {
  const text = raw.trim()
  const lower = text.toLowerCase()

  const asksSpend = /(how much|what|show).*(spend|spent)|\bspent\b|\bspend\b/.test(lower)
  const asksDeposit = /(how much|what|show).*(deposit|deposited)|\bdeposited\b|\bdeposit\b/.test(lower)
  const asksBalance = /(wallet balance|my balance|balance|how much.*have|how much is in my wallet)/.test(lower)
  const asksToday = /(today|since morning|this day)/.test(lower)
  const asksAllTime = /(so far|all time|overall|in total|total so far|ever)/.test(lower)
  const asksActivity = /(activity|transactions count|how many transactions|transaction count)/.test(lower)

  if (asksSpend && asksToday) {
    return {
      kind: "insight",
      title: "Spending Today",
      summary: "Fetch total spending for today.",
      actionLabel: "Get Answer",
      insightKey: "spent_today",
      confidence: 0.95,
    }
  }

  if (asksSpend && (asksAllTime || !asksToday)) {
    return {
      kind: "insight",
      title: "Spending So Far",
      summary: "Fetch total spending so far.",
      actionLabel: "Get Answer",
      insightKey: "spent_all_time",
      confidence: 0.93,
    }
  }

  if (asksDeposit && asksToday) {
    return {
      kind: "insight",
      title: "Deposits Today",
      summary: "Fetch total deposited today.",
      actionLabel: "Get Answer",
      insightKey: "deposited_today",
      confidence: 0.92,
    }
  }

  if (asksDeposit && (asksAllTime || !asksToday)) {
    return {
      kind: "insight",
      title: "Deposits So Far",
      summary: "Fetch total deposited so far.",
      actionLabel: "Get Answer",
      insightKey: "deposited_all_time",
      confidence: 0.9,
    }
  }

  if (asksBalance) {
    return {
      kind: "insight",
      title: "Wallet Balance",
      summary: "Fetch your current wallet balance.",
      actionLabel: "Get Answer",
      insightKey: "balance",
      confidence: 0.94,
    }
  }

  if (asksActivity && asksToday) {
    return {
      kind: "insight",
      title: "Activity Today",
      summary: "Fetch your transaction activity count for today.",
      actionLabel: "Get Answer",
      insightKey: "activity_today",
      confidence: 0.87,
    }
  }

  const swapDirect = lower.match(/(?:swap|convert|exchange)\s+([\d.,]+)\s*(ntzs|usdc)\s+(?:to|for)\s+(ntzs|usdc)/i)
  if (swapDirect) {
    const amount = Number(swapDirect[1].replace(/,/g, ""))
    const fromToken = swapDirect[2].toUpperCase() as SwapToken
    const toToken = swapDirect[3].toUpperCase() as SwapToken
    if (Number.isFinite(amount) && amount > 0 && fromToken !== toToken) {
      return {
        kind: "swap",
        title: "Swap",
        summary: `Swap ${amount.toLocaleString()} ${fromToken} to ${toToken}.`,
        actionLabel: "Execute Swap",
        amount,
        fromToken,
        toToken,
        confidence: 0.95,
      }
    }
  }

  const sendDirect = lower.match(/(?:send|transfer|pay)\s+([\d.,]+)\s*ntzs?\s+(?:to)\s+(@?[a-z0-9_.-]+|0x[a-f0-9]{10,})/i)
  if (sendDirect) {
    const amount = Number(sendDirect[1].replace(/,/g, ""))
    const recipient = sendDirect[2]
    if (Number.isFinite(amount) && amount > 0) {
      return {
        kind: "send",
        title: "Send nTZS",
        summary: `Send ${amount.toLocaleString()} nTZS to ${recipient}.`,
        actionLabel: "Open Send",
        actionHref: `/app/user/wallet?agent=send&to=${encodeURIComponent(recipient)}&amount=${encodeURIComponent(String(amount))}`,
        amount,
        recipient,
        confidence: 0.92,
      }
    }
  }

  if (/(send|transfer|pay)/i.test(lower)) {
    return {
      kind: "send",
      title: "Send nTZS",
      summary: "Open send flow and execute transfer.",
      actionLabel: "Open Send",
      actionHref: "/app/user/wallet?agent=send",
      confidence: 0.78,
    }
  }

  if (/(swap|convert|exchange)/i.test(lower) && /(ntzs|usdc)/i.test(lower)) {
    const amountMatch = lower.match(/([\d.,]+)/)
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : 0
    const hasUsdc = /\busdc\b/i.test(lower)
    const hasNtzs = /\bntzs\b/i.test(lower)
    const fromToken: SwapToken = hasUsdc && !hasNtzs ? "USDC" : "NTZS"
    const toToken: SwapToken = fromToken === "USDC" ? "NTZS" : "USDC"

    if (Number.isFinite(amount) && amount > 0) {
      return {
        kind: "swap",
        title: "Swap",
        summary: `Swap ${amount.toLocaleString()} ${fromToken} to ${toToken}.`,
        actionLabel: "Execute Swap",
        amount,
        fromToken,
        toToken,
        confidence: 0.8,
      }
    }
  }

  if (/(deposit|add funds|top up|fund wallet)/i.test(lower)) {
    return {
      kind: "deposit",
      title: "Deposit",
      summary: "Open deposit flow and execute funding.",
      actionLabel: "Open Deposit",
      actionHref: "/app/user/deposits/new",
      confidence: 0.88,
    }
  }

  if (/(withdraw|cash ?out|payout)/i.test(lower)) {
    return {
      kind: "withdraw",
      title: "Withdraw",
      summary: "Open withdrawal flow and execute payout.",
      actionLabel: "Open Withdraw",
      actionHref: "/app/user/withdraw",
      confidence: 0.88,
    }
  }

  if (/(save|savings|stake|yield)/i.test(lower)) {
    return {
      kind: "save",
      title: "Savings",
      summary: "Open savings execution flow.",
      actionLabel: "Open Savings",
      actionHref: "/app/user/stake",
      confidence: 0.85,
    }
  }

  if (/(activity|transactions|history)/i.test(lower)) {
    return {
      kind: "activity",
      title: "Activity",
      summary: "Open transaction activity.",
      actionLabel: "Open Activity",
      actionHref: "/app/user/activity",
      confidence: 0.9,
    }
  }

  if (/(markets|dse|prices|quotes)/i.test(lower)) {
    return {
      kind: "markets",
      title: "Markets",
      summary: "Open live markets.",
      actionLabel: "Open Markets",
      actionHref: "https://dse.co.tz/",
      confidence: 0.84,
    }
  }

  if (/(news|citizen|headlines)/i.test(lower)) {
    return {
      kind: "news",
      title: "News",
      summary: "Open financial news.",
      actionLabel: "Open News",
      actionHref: "https://www.thecitizen.co.tz/tanzania/news/national",
      confidence: 0.84,
    }
  }

  return {
    kind: "unknown",
    title: "Intent not executable",
    summary: "I can execute swaps, sends, deposits, withdrawals, and answer spend/balance/activity questions.",
    actionLabel: "Adjust Intent",
    confidence: 0.2,
  }
}

function formatTzs(value: number) {
  return `${value.toLocaleString()} TZS`
}

export function AIOrbit({
  walletBalance,
  savingsBalance = 0,
  savingsYieldEarned = 0,
  savingsRatePercent = 0,
  recentTxCount = 0,
  lastTxAmountTzs = 0,
}: AIOrbitProps) {
  const router = useRouter()

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
      actionHref: walletBalance > 0 ? "/app/user/withdraw" : "/app/user/deposits/new",
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
      actionHref: "/app/user/activity",
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

  const [nodes, setNodes] = useState<TimelineItem[]>(timelineData)
  const [input, setInput] = useState("")
  const [isThinking, setIsThinking] = useState(false)
  const [autoExpandId, setAutoExpandId] = useState<number | null>(null)
  const [closeOrbTrigger, setCloseOrbTrigger] = useState(0)
  const [executionPlan, setExecutionPlan] = useState<ExecutionPlan | null>(null)
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>("idle")
  const [executionError, setExecutionError] = useState<string | null>(null)
  const [executionLogs, setExecutionLogs] = useState<string[]>([])
  const [swapAmount, setSwapAmount] = useState("")
  const [swapFromToken, setSwapFromToken] = useState<SwapToken>("NTZS")
  const [swapToToken, setSwapToToken] = useState<SwapToken>("USDC")
  const [slippageBps, setSlippageBps] = useState("100")
  const [isListening, setIsListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const [speechError, setSpeechError] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsContext | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const aiNodeCounter = useRef(100)

  const fetchAnalyticsContext = async () => {
    setAnalyticsLoading(true)
    try {
      const res = await fetch("/app/user/ai/context", { credentials: "include" })
      if (!res.ok) throw new Error("Failed to load analytics")
      const json = await res.json() as AnalyticsContext
      setAnalytics(json)
      return json
    } catch {
      return null
    } finally {
      setAnalyticsLoading(false)
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionCtor
      webkitSpeechRecognition?: SpeechRecognitionCtor
    }
    const hasSpeech = !!speechWindow.SpeechRecognition || !!speechWindow.webkitSpeechRecognition
    setSpeechSupported(hasSpeech)
  }, [])

  useEffect(() => {
    fetchAnalyticsContext()
  }, [])

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch {
          // no-op
        }
      }
    }
  }, [])

  const appendExecutionNode = (title: string, content: string, status: TimelineItem["status"]) => {
    const newId = ++aiNodeCounter.current
    const newNode: TimelineItem = {
      id: newId,
      title,
      date: "AGENT",
      content,
      category: "Execution",
      icon: MessageSquare,
      relatedIds: [],
      status,
      energy: status === "completed" ? 95 : status === "in-progress" ? 70 : 20,
      accentColor: "violet",
    }
    setNodes((prev) => [...prev, newNode])
    setTimeout(() => setAutoExpandId(newId), 220)
  }

  const submitIntent = (rawText: string) => {
    const text = rawText.trim()
    if (!text || isThinking) return
    setInput("")
    setSpeechError(null)
    const plan = parseIntent(text)
    setExecutionPlan(plan)
    setExecutionStatus(plan.kind === "unknown" ? "failed" : "ready")
    setExecutionError(plan.kind === "unknown" ? "Could not map intent to an executable action." : null)
    setExecutionLogs([])
    if (plan.kind === "swap") {
      setSwapAmount(String(plan.amount ?? ""))
      setSwapFromToken(plan.fromToken ?? "NTZS")
      setSwapToToken(plan.toToken ?? "USDC")
      setSlippageBps("100")
    }
    appendExecutionNode(plan.title, plan.summary, plan.kind === "unknown" ? "pending" : "in-progress")
  }

  const handleSend = () => {
    submitIntent(input)
  }

  const toggleVoiceCapture = () => {
    if (!speechSupported || isThinking) {
      setSpeechError("Voice capture is not available on this device/browser.")
      return
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop()
      return
    }

    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionCtor
      webkitSpeechRecognition?: SpeechRecognitionCtor
    }
    const RecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!RecognitionCtor) {
      setSpeechError("Voice capture is not available on this browser.")
      return
    }

    const recognition = new RecognitionCtor()
    recognitionRef.current = recognition
    recognition.lang = "en-US"
    recognition.continuous = false
    recognition.interimResults = true

    let finalTranscript = ""

    recognition.onstart = () => {
      setSpeechError(null)
      setIsListening(true)
    }

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = ""
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript ?? ""
        if (event.results[i].isFinal) {
          finalTranscript += transcript
        } else {
          interim += transcript
        }
      }
      setInput((finalTranscript + interim).trim())
    }

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      setSpeechError(event?.error === "not-allowed" ? "Microphone permission denied." : "Voice capture failed. Try again.")
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
      const transcript = finalTranscript.trim()
      if (transcript) {
        submitIntent(transcript)
      }
    }

    try {
      recognition.start()
    } catch {
      setSpeechError("Unable to start voice capture.")
      setIsListening(false)
    }
  }

  const executeSwap = async () => {
    const amount = Number(swapAmount)
    const slippage = Number(slippageBps)
    if (!Number.isFinite(amount) || amount <= 0 || swapFromToken === swapToToken) {
      setExecutionStatus("failed")
      setExecutionError("Invalid swap parameters.")
      return
    }

    setIsThinking(true)
    setExecutionStatus("running")
    setExecutionError(null)
    setExecutionLogs(["Preparing swap..."])

    try {
      const response = await fetch("/app/user/wallet/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromToken: swapFromToken,
          toToken: swapToToken,
          amount,
          slippageBps: Number.isFinite(slippage) && slippage > 0 ? slippage : 100,
        }),
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || "Swap execution failed")
      }

      if (!response.body) {
        throw new Error("Execution stream unavailable")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let filled = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split("\n\n")
        buffer = events.pop() ?? ""

        for (const evt of events) {
          const line = evt
            .split("\n")
            .find((ln) => ln.startsWith("data: "))
          if (!line) continue

          try {
            const payload = JSON.parse(line.slice(6)) as {
              status?: string
              message?: string
              txHash?: string
            }

            const status = payload.status ?? "UPDATE"
            const msg = payload.message ?? status
            const suffix = payload.txHash ? ` · ${payload.txHash.slice(0, 10)}...` : ""
            setExecutionLogs((prev) => [...prev, `${status}: ${msg}${suffix}`])

            if (status === "FILLED") {
              filled = true
            }
            if (status === "FAILED") {
              throw new Error(payload.message || "Swap failed")
            }
          } catch (err) {
            if (err instanceof Error) throw err
          }
        }
      }

      setExecutionStatus(filled ? "success" : "failed")
      if (filled) {
        appendExecutionNode("Swap Executed", `Swapped ${amount.toLocaleString()} ${swapFromToken} to ${swapToToken}.`, "completed")
      } else {
        setExecutionError("Swap did not complete.")
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Execution failed"
      setExecutionStatus("failed")
      setExecutionError(message)
      setExecutionLogs((prev) => [...prev, `FAILED: ${message}`])
    } finally {
      setIsThinking(false)
    }
  }

  const executeInsight = async (plan: ExecutionPlan) => {
    const key = plan.insightKey
    if (!key) {
      setExecutionStatus("failed")
      setExecutionError("Insight intent is missing a metric key.")
      return
    }

    setIsThinking(true)
    setExecutionStatus("running")
    setExecutionError(null)
    setExecutionLogs(["Loading account analytics..."])

    const current = analytics ?? await fetchAnalyticsContext()
    if (!current) {
      setExecutionStatus("failed")
      setExecutionError("Could not load your activity and balance data right now.")
      setIsThinking(false)
      return
    }

    let answer = ""
    if (key === "balance") {
      answer = `Your current wallet balance is ${formatTzs(current.walletBalanceTzs)} (${current.walletBalanceSource}).`
    } else if (key === "spent_today") {
      answer = `You spent ${formatTzs(current.spentTodayTzs)} today.`
    } else if (key === "spent_all_time") {
      answer = `You have spent ${formatTzs(current.spentAllTimeTzs)} so far.`
    } else if (key === "deposited_today") {
      answer = `You deposited ${formatTzs(current.depositedTodayTzs)} today.`
    } else if (key === "deposited_all_time") {
      answer = `You have deposited ${formatTzs(current.depositedAllTimeTzs)} so far.`
    } else if (key === "activity_today") {
      answer = `You have ${current.activityCountToday} activities today.`
    }

    setExecutionLogs((prev) => [...prev, answer])
    appendExecutionNode(plan.title, answer, "completed")
    setExecutionStatus("success")
    setIsThinking(false)
  }

  const executeIntent = async () => {
    if (!executionPlan) return

    if (executionPlan.kind === "swap") {
      await executeSwap()
      return
    }

    if (executionPlan.kind === "insight") {
      await executeInsight(executionPlan)
      return
    }

    if (executionPlan.actionHref) {
      setExecutionStatus("running")
      setIsThinking(true)
      setExecutionLogs([`Opening ${executionPlan.title}...`])
      appendExecutionNode(executionPlan.title, `Executing ${executionPlan.title.toLowerCase()} flow.`, "in-progress")
      if (executionPlan.actionHref.startsWith("http")) {
        window.open(executionPlan.actionHref, "_blank", "noopener,noreferrer")
      } else {
        router.push(executionPlan.actionHref)
      }
      setExecutionStatus("success")
      setIsThinking(false)
      setCloseOrbTrigger((n) => n + 1)
      return
    }

    setExecutionStatus("failed")
    setExecutionError("Intent is not executable yet.")
  }

  const orbCard = (
    <div className="relative p-4 space-y-3">
      <textarea
        autoFocus
        rows={3}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() }
        }}
        placeholder="Describe what to execute. Example: swap 25000 NTZS to USDC"
        disabled={isThinking}
        className="w-full resize-none rounded-2xl border-0 bg-transparent py-2 pl-1 pr-12 text-sm text-white placeholder-white/30 outline-none disabled:opacity-50"
      />
      <button
        type="button"
        onClick={toggleVoiceCapture}
        disabled={isThinking || !speechSupported}
        className="absolute bottom-4 right-14 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 transition-all active:scale-95 disabled:opacity-35"
        title={speechSupported ? (isListening ? "Stop voice" : "Start voice") : "Voice not supported"}
      >
        {isListening ? <MicOff className="h-4 w-4 text-rose-300" /> : <Mic className="h-4 w-4" />}
      </button>
      <button
        onClick={handleSend}
        disabled={!input.trim() || isThinking}
        className="absolute bottom-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-900/50 transition-all active:scale-95 disabled:opacity-40"
      >
        {isThinking ? (
          <div className="h-3.5 w-3.5 rounded-sm bg-fuchsia-200 animate-spin" style={{ animationDuration: "1.2s" }} />
        ) : (
          <CornerRightUp className="h-4 w-4" />
        )}
      </button>

      {executionPlan && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-300/80">Execution Sheet</p>
            <span className="text-[10px] text-white/40">{Math.round(executionPlan.confidence * 100)}% confidence</span>
          </div>

          <p className="text-sm text-white">{executionPlan.title}</p>
          <p className="mt-1 text-xs text-white/60">{executionPlan.summary}</p>

          {executionPlan.kind === "insight" && (
            <div className="mt-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-white/50">
              {analyticsLoading ? "Refreshing metrics..." : analytics ? `Metrics updated ${new Date(analytics.updatedAt).toLocaleTimeString()}` : "Metrics not loaded yet"}
            </div>
          )}

          {executionPlan.kind === "swap" && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="col-span-2 text-[10px] uppercase tracking-wider text-white/40">Amount</label>
              <input
                value={swapAmount}
                onChange={(e) => setSwapAmount(e.target.value)}
                type="number"
                min="0"
                step="any"
                disabled={isThinking}
                className="col-span-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-violet-400/50"
              />

              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/40">From</label>
                <select
                  value={swapFromToken}
                  onChange={(e) => setSwapFromToken(e.target.value as SwapToken)}
                  disabled={isThinking}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
                >
                  <option value="NTZS">NTZS</option>
                  <option value="USDC">USDC</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/40">To</label>
                <select
                  value={swapToToken}
                  onChange={(e) => setSwapToToken(e.target.value as SwapToken)}
                  disabled={isThinking}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
                >
                  <option value="NTZS">NTZS</option>
                  <option value="USDC">USDC</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-white/40">Slippage (bps)</label>
                <input
                  value={slippageBps}
                  onChange={(e) => setSlippageBps(e.target.value)}
                  type="number"
                  min="1"
                  step="1"
                  disabled={isThinking}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-violet-400/50"
                />
              </div>
            </div>
          )}

          {executionError && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{executionError}</span>
            </div>
          )}

          {executionLogs.length > 0 && (
            <div className="mt-3 max-h-28 overflow-y-auto rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              {executionLogs.map((log, idx) => (
                <p key={`${log}-${idx}`} className="text-[11px] text-white/60 leading-relaxed">
                  {log}
                </p>
              ))}
            </div>
          )}

          <button
            onClick={executeIntent}
            disabled={isThinking || executionPlan.kind === "unknown"}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-3 py-2.5 text-xs font-semibold text-white shadow-lg shadow-violet-900/40 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {executionStatus === "running" || isThinking ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Executing...
              </>
            ) : executionStatus === "success" ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Executed
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                {executionPlan.actionLabel}
              </>
            )}
          </button>
        </div>
      )}

      {speechError && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          {speechError}
        </div>
      )}

      {!speechError && isListening && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-[11px] text-blue-300">
          Listening... speak your intent, then pause.
        </div>
      )}
    </div>
  )

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
        <div className="flex items-center gap-2">
          {speechSupported && (
            <button
              type="button"
              onClick={toggleVoiceCapture}
              disabled={isThinking}
              className="group inline-flex items-center gap-1.5 rounded-full border border-blue-500/25 bg-blue-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-blue-300/90 transition-all hover:bg-blue-500/15 disabled:opacity-40"
              title={isListening ? "Listening... tap to stop" : "Tap to speak to AI"}
            >
              {isListening ? <MicOff className="h-3 w-3 text-rose-300" /> : <Mic className="h-3 w-3" />}
              <span>{isListening ? "Listening" : "Voice"}</span>
              <span className={`h-1.5 w-1.5 rounded-full ${isListening ? "animate-pulse bg-blue-300" : "bg-blue-300/70"}`} />
            </button>
          )}
          <div className="flex items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1">
            <span className={`h-1.5 w-1.5 rounded-full ${isThinking ? "animate-ping bg-fuchsia-400" : "animate-pulse bg-violet-400"}`} />
            <span className="text-[10px] font-medium uppercase tracking-widest text-violet-400/80">
              {isThinking ? "Thinking" : "Online"}
            </span>
          </div>
        </div>
      </div>

      <p className="mb-1 px-0.5 text-[11px] text-zinc-700">
        {isThinking ? "Executing intent..." : isListening ? "Listening for voice intent..." : "Tap the orb and type or speak an intent to execute"}
      </p>

      <RadialOrbitalTimeline
        timelineData={nodes}
        isThinking={isThinking}
        autoExpandId={autoExpandId}
        orbCardContent={orbCard}
        closeOrbTrigger={closeOrbTrigger}
      />
    </div>
  )
}
