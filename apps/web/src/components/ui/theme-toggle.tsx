'use client'

import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

/* Sun/moon switch for the site-wide light mode. Defaults to token-based
   styling that flips with the theme; pass className to match a specific
   nav (e.g. the always-light landing header). */
export default function ThemeToggle({
  className = 'border border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white',
}: {
  className?: string
}) {
  // resolvedTheme is undefined until next-themes hydrates, so the server
  // and first client render both show the sun icon — no mismatch.
  const { resolvedTheme, setTheme } = useTheme()
  const isLight = resolvedTheme === 'light'

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
