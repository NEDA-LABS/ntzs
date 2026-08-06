'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Scan a real merchant QR with the laptop/phone camera and see exactly what we
 * make of it.
 *
 * Two jobs at once. For an operator it is the missing first step of the spend
 * test — point the camera at a till sticker and get a pay number, instead of
 * typing one. For us it is evidence: `lib/psp/qr.ts` deliberately does not
 * assume which template tag carries the Lipa Namba, because that is defined by
 * the Tanzanian scheme and we had no real code to read it from. One scan here
 * shows the tag, the scheme GUID, and which candidate the acquirer recognises.
 *
 * Decoding uses the browser's native BarcodeDetector where it exists (Chrome,
 * Edge, Android) so no scanning library is shipped. Everywhere else — and
 * whenever a camera is impractical — the payload can be pasted, which is the
 * same code path from the decode onwards.
 */

interface DecodeResponse {
  payload: string
  ok: boolean
  code?: string
  error?: string
  decoded?: {
    dynamic: boolean
    merchantName: string | null
    merchantCity: string | null
    countryCode: string | null
    currencyNumeric: string | null
    amountTzs: number | null
    merchantCategoryCode: string | null
    reference: string | null
    accounts: Array<{ tag: string; guid: string | null; values: string[] }>
    candidateTillNumbers: string[]
  }
  attempts?: Array<{ payNumber: string; name: string | null; reason?: string }>
  resolution?: 'resolved' | 'ambiguous' | 'unresolved'
  payNumber?: string | null
  merchantName?: string | null
  nameMatch?: boolean | null
}

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
}

const inputCls =
  'w-full rounded-xl border border-white/10 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-emerald-500/50 focus:outline-none'

export default function QrScanPanel({
  onUseTill,
}: {
  onUseTill: (payNumber: string, amountTzs: number | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const [scanning, setScanning] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DecodeResponse | null>(null)
  const [copied, setCopied] = useState(false)

  const cameraSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window

  const stopCamera = useCallback(() => {
    if (scanTimer.current) {
      clearInterval(scanTimer.current)
      scanTimer.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setScanning(false)
  }, [])

  // A camera left running after the operator navigates away is both a battery
  // drain and a bad look on a shared machine.
  useEffect(() => stopCamera, [stopCamera])

  const decode = useCallback(
    async (payload: string) => {
      setBusy(true)
      setResult(null)
      try {
        const res = await fetch('/api/admin/qr-decode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload }),
        })
        const json = (await res.json()) as DecodeResponse
        setResult(res.ok ? json : { payload, ok: false, error: json.error ?? `HTTP ${res.status}` })
      } catch (e) {
        setResult({ payload, ok: false, error: e instanceof Error ? e.message : 'request failed' })
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const startCamera = useCallback(async () => {
    setCameraError(null)
    setResult(null)
    if (!cameraSupported) {
      setCameraError('This browser has no built-in QR reader. Use Chrome or Edge, or paste the payload below.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      setScanning(true)
      // The <video> only exists once `scanning` renders it.
      setTimeout(async () => {
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play().catch(() => undefined)

        const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => BarcodeDetectorLike })
          .BarcodeDetector
        const detector = new Detector({ formats: ['qr_code'] })

        scanTimer.current = setInterval(async () => {
          const v = videoRef.current
          if (!v || v.readyState < 2) return
          try {
            const codes = await detector.detect(v)
            const raw = codes[0]?.rawValue
            if (raw) {
              stopCamera()
              setPasted(raw)
              void decode(raw)
            }
          } catch {
            // A single failed frame is normal — keep looking.
          }
        }, 300)
      }, 50)
    } catch (e) {
      setCameraError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow it in the address bar, or paste the payload below.'
          : e instanceof Error
            ? e.message
            : 'Could not open the camera.'
      )
    }
  }, [cameraSupported, decode, stopCamera])

  const copyPayload = async () => {
    if (!result?.payload) return
    try {
      await navigator.clipboard.writeText(result.payload)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const d = result?.decoded

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">
        Point the camera at a merchant TANQR sticker. This decodes it, resolves the till against Selcom, and hands the
        pay number to the Lipa Namba tab. Nothing here moves money.
      </p>

      <div className="flex flex-wrap gap-2">
        {scanning ? (
          <button
            type="button"
            onClick={stopCamera}
            className="rounded-xl bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-400 transition-colors hover:bg-rose-500/20"
          >
            Stop camera
          </button>
        ) : (
          <button
            type="button"
            onClick={startCamera}
            className="rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20"
          >
            📷 Scan a merchant QR
          </button>
        )}
      </div>

      {cameraError && <p className="text-xs text-amber-400">{cameraError}</p>}

      {scanning && (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
          <video ref={videoRef} playsInline muted className="h-64 w-full object-cover" />
          <p className="border-t border-white/10 px-4 py-2 text-xs text-zinc-500">
            Hold the code steady in frame — it reads automatically.
          </p>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">
          Or paste the payload <span className="text-zinc-600">(a merchant QR always starts 000201)</span>
        </label>
        <div className="flex gap-2">
          <input
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="00020101021126…"
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => void decode(pasted.trim())}
            disabled={!pasted.trim() || busy}
            className="shrink-0 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600"
          >
            {busy ? 'Decoding…' : 'Decode'}
          </button>
        </div>
      </div>

      {result && !result.ok && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
          <p className="text-sm font-medium text-rose-400">{result.code ?? 'decode_failed'}</p>
          <p className="mt-1 text-xs text-rose-300/80">{result.error}</p>
        </div>
      )}

      {result?.ok && d && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-black/40 p-5">
          {/* Verdict */}
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                result.resolution === 'resolved'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : result.resolution === 'ambiguous'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-zinc-500/20 text-zinc-300'
              }`}
            >
              {result.resolution}
            </span>
            {result.payNumber && (
              <span className="font-mono text-sm text-white">
                Till {result.payNumber}
                {result.merchantName ? ` — ${result.merchantName}` : ''}
              </span>
            )}
            {result.payNumber && (
              <button
                type="button"
                onClick={() => onUseTill(result.payNumber!, d.amountTzs)}
                className="rounded-xl bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20"
              >
                Use this till →
              </button>
            )}
          </div>

          {result.nameMatch === false && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
              ⚠ The name printed in this code (&ldquo;{d.merchantName}&rdquo;) does not match the registered account
              holder (&ldquo;{result.merchantName}&rdquo;). On a real payment screen this is what a swapped sticker looks
              like.
            </p>
          )}

          {/* What the code says */}
          <div className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            <Row label="Merchant (in QR)" value={d.merchantName} />
            <Row label="City" value={d.merchantCity} />
            <Row label="Country" value={d.countryCode} />
            <Row label="Currency" value={d.currencyNumeric === '834' ? 'TZS (834)' : d.currencyNumeric} />
            <Row label="Amount" value={d.amountTzs ? `TZS ${d.amountTzs.toLocaleString()}` : '— (static code)'} />
            <Row label="Type" value={d.dynamic ? 'dynamic (merchant set the amount)' : 'static sticker'} />
            <Row label="MCC" value={d.merchantCategoryCode} />
            <Row label="Reference" value={d.reference} />
          </div>

          {/* The bit we could not know without a real code */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Merchant account templates</p>
            <div className="space-y-1.5">
              {d.accounts.length === 0 && <p className="text-xs text-zinc-600">None found.</p>}
              {d.accounts.map((a) => (
                <div key={a.tag} className="rounded-lg border border-white/10 bg-zinc-900/60 px-3 py-2 font-mono text-xs">
                  <span className="text-emerald-400">tag {a.tag}</span>
                  {a.guid && <span className="text-zinc-400"> · guid {a.guid}</span>}
                  {a.values.length > 0 && <span className="text-zinc-300"> · {a.values.join(' | ')}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Which candidate the acquirer recognised */}
          {result.attempts && result.attempts.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-zinc-400">Selcom verdict per candidate</p>
              <div className="space-y-1.5">
                {result.attempts.map((a) => (
                  <div key={a.payNumber} className="flex items-baseline gap-2 text-xs">
                    <span className="font-mono text-zinc-300">{a.payNumber}</span>
                    {a.name ? (
                      <span className="text-emerald-400">✓ {a.name}</span>
                    ) : (
                      <span className="text-zinc-500">✕ {a.reason ?? 'no record'}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* The raw string — the thing worth keeping */}
          <div>
            <div className="mb-1.5 flex items-center gap-3">
              <p className="text-xs font-medium text-zinc-400">Raw payload</p>
              <button
                type="button"
                onClick={copyPayload}
                className="rounded-lg border border-white/10 px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="break-all rounded-lg bg-black px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-400">
              {result.payload}
            </p>
            <p className="mt-1.5 text-xs text-zinc-600">
              Keep this. It is the real-world sample the decoder&apos;s tests should be pinned to.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/5 pb-1">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right text-zinc-200">{value || '—'}</span>
    </div>
  )
}
