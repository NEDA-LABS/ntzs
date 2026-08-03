'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

const noopSubscribe = () => () => {}

/* Sun/moon switch for the site-wide light mode. Defaults to token-based
   styling that flips with the theme; pass className to match a specific
   nav (e.g. the always-light landing header). */
export default function ThemeToggle({
  className = 'border border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white',
}: {
  className?: string
}) {
  // next-themes only returns undefined on the *server* (its getTheme bails on
  // `typeof window === "undefined"`); the provider's useState initialiser reads
  // localStorage synchronously, so a stored `light` makes the client's first
  // render disagree with the SSR'd markup — on the icon and on aria-label.
  // suppressHydrationWarning sits on <html> and doesn't cover this button, so
  // hold the server's rendering until mounted.
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const isLight = mounted && resolvedTheme === 'light'

  return (
    <button
      type="button"
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      onClick={() => setTheme(isLight ? 'dark' : 'light')}
      className={`inline-flex h-8 w-8 items-center justify-center transition-colors ${className}`}
    >
      {isLight ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
    </button>
  )
}
