export function track(event: string, payload?: Record<string, unknown>) {
  try {
    const body = JSON.stringify({ event, payload, ts: Date.now(), path: typeof window !== 'undefined' ? window.location.pathname : undefined })
    const url = '/app/api/telemetry/event'
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon(url, blob)
      return
    }
    // Fallback
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  } catch (err) {
    // Never throw from telemetry
    console.debug('[telemetry] track error', err)
  }
}
