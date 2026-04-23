'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { sendNtzsAction, type SendNtzsResult } from './actions'
import { sendUsdcAction, type SendUsdcResult } from './send-usdc-action'

type Token = 'NTZS' | 'USDC'
type Result = SendNtzsResult | SendUsdcResult | null

export function SendModal({ walletAddress }: { walletAddress: string }) {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState<Token>('NTZS')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [result, setResult] = useState<Result>(null)
  const [isPending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const onOpen = () => { reset(); setOpen(true) }
    window.addEventListener('wallet:openSend', onOpen)
    return () => window.removeEventListener('wallet:openSend', onOpen)
  }, [])

  function reset() {
    setTo('')
    setAmount('')
    setResult(null)
  }

  function handleClose() {
    setOpen(false)
    setTimeout(reset, 300)
  }

  function handleTokenSwitch(t: Token) {
    setToken(t)
    setResult(null)
    setTo('')
    setAmount('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.set('to', to.trim())
    fd.set('amount', amount.trim())
    startTransition(async () => {
      const res = token === 'NTZS'
        ? await sendNtzsAction(fd)
        : await sendUsdcAction(fd)
      setResult(res)
    })
  }

  const isSuccess = result?.success === true
  const errorMsg = result && !result.success ? result.error : null

  // Pull tx hash and display amount from result
  let txHash = ''
  let displayAmount = ''
  let displayTo = ''
  if (result?.success) {
    if (token === 'NTZS') {
      const r = result as SendNtzsResult & { success: true }
      txHash = r.mintTxHash
      displayAmount = r.amountTzs.toLocaleString(undefined, { maximumFractionDigits: 4 })
      displayTo = r.toAddress
    } else {
      const r = result as SendUsdcResult & { success: true }
      txHash = r.txHash
      displayAmount = r.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })
      displayTo = r.toAddress
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
          />

          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg rounded-t-3xl bg-[#0f0f1a] p-6 ring-1 ring-white/[0.07] pb-safe"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/10" />

            {isSuccess ? (
              /* ── Success ── */
              <div className="space-y-5 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/25">
                  <svg className="h-7 w-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-bold text-white">Sent!</p>
                  <p className="mt-1 text-sm text-zinc-400">
                    {displayAmount}{' '}
                    <span className={token === 'NTZS' ? 'text-violet-400' : 'text-blue-400'}>{token === 'NTZS' ? 'nTZS' : 'USDC'}</span>
                    {' '}sent to{' '}
                    <span className="font-mono text-xs text-zinc-300">
                      {displayTo.slice(0, 6)}…{displayTo.slice(-4)}
                    </span>
                  </p>
                </div>
                <a
                  href={`https://basescan.org/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-mono text-blue-400 hover:bg-white/10 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View on BaseScan
                </a>
                <button
                  type="button"
                  onClick={handleClose}
                  className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-75 active:scale-[0.98]"
                >
                  Done
                </button>
              </div>
            ) : (
              /* ── Form ── */
              <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">Send</h2>
                  <button type="button" onClick={handleClose} className="rounded-full p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white transition-colors">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Token toggle */}
                <div className="flex gap-1 rounded-2xl bg-white/[0.04] p-1">
                  {(['NTZS', 'USDC'] as Token[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleTokenSwitch(t)}
                      className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-all ${
                        token === t
                          ? t === 'NTZS'
                            ? 'bg-violet-600/30 text-violet-300 ring-1 ring-violet-500/30'
                            : 'bg-blue-600/30 text-blue-300 ring-1 ring-blue-500/30'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {t === 'NTZS' ? 'nTZS' : 'USDC'}
                    </button>
                  ))}
                </div>

                {/* Network badge */}
                <div className="flex items-center gap-1.5 rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/[0.06]">
                  <span className={`h-1.5 w-1.5 rounded-full ${token === 'NTZS' ? 'bg-violet-400' : 'bg-blue-400'}`} />
                  <span className="text-[11px] font-medium text-zinc-500">
                    {token === 'NTZS'
                      ? 'Base network · supports 0x address or @alias'
                      : 'Base network · 0x address only'}
                  </span>
                </div>

                {/* To */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-zinc-500">To</label>
                  <input
                    type="text"
                    value={to}
                    onChange={(e) => { setTo(e.target.value); setResult(null) }}
                    placeholder={token === 'NTZS' ? '0x… address or @alias' : '0x… address'}
                    required
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-2xl border border-white/[0.07] bg-black/30 px-4 py-3 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                  />
                </div>

                {/* Amount */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-zinc-500">Amount</label>
                  <div className="flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-black/30 px-4 py-3 focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/30">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => { setAmount(e.target.value); setResult(null) }}
                      placeholder="0.00"
                      min="0.000001"
                      step="any"
                      required
                      className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                    />
                    <span className={`text-xs font-semibold ${token === 'NTZS' ? 'text-violet-400' : 'text-blue-400'}`}>
                      {token === 'NTZS' ? 'nTZS' : 'USDC'}
                    </span>
                  </div>
                </div>

                {/* Error */}
                {errorMsg && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300 ring-1 ring-rose-500/20"
                  >
                    {errorMsg}
                  </motion.p>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isPending || !to.trim() || !amount.trim()}
                  className={`w-full rounded-2xl py-3.5 text-sm font-semibold text-white shadow-lg transition-all duration-75 disabled:opacity-50 active:scale-[0.98] ${
                    token === 'NTZS'
                      ? 'bg-gradient-to-r from-violet-600 to-violet-500 shadow-violet-500/25 hover:shadow-violet-500/40'
                      : 'bg-gradient-to-r from-blue-600 to-blue-500 shadow-blue-500/25 hover:shadow-blue-500/40'
                  }`}
                >
                  {isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Sending…
                    </span>
                  ) : `Send ${token === 'NTZS' ? 'nTZS' : 'USDC'}`}
                </button>
              </form>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
