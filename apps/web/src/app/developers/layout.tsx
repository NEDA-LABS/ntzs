'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'

function AuthButtons() {
  const router = useRouter()
  const pathname = usePathname()
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    // Check if partner_session cookie exists
    const hasSession = document.cookie.includes('partner_session=')
    setIsLoggedIn(hasSession)
  }, [pathname])

  const handleLogout = async () => {
    setLoggingOut(true)
    // Clear the session cookie
    document.cookie = 'partner_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    setIsLoggedIn(false)
    router.push('/developers/login')
  }

  if (isLoggedIn) {
    return (
      <button
        onClick={handleLogout}
        disabled={loggingOut}
        className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
      >
        {loggingOut ? 'Logging out...' : 'Log out'}
      </button>
    )
  }

  return (
    <>
      <Link
        className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
        href="/developers/login"
      >
        Log in
      </Link>
      <Link
        className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black transition-colors hover:bg-white/90"
        href="/developers/signup"
      >
        Get API Key
      </Link>
    </>
  )
}

export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-black text-white">
      <div className="pointer-events-none absolute inset-0 opacity-50">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(121,40,202,0.2),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(0,112,243,0.2),transparent_45%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <header className="relative z-10 border-b border-white/10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-3">
              <div className="overflow-hidden rounded-full">
                <Image src="/ntzs-logo.png" alt="nTZS" width={30} height={30} />
              </div>
              <div className="text-sm font-semibold tracking-wide">nTZS</div>
            </Link>
            <div className="hidden items-center gap-1 text-sm md:flex">
              <span className="text-white/30">/</span>
              <span className="ml-1 text-white/70">Developers</span>
            </div>
          </div>

          <nav className="hidden items-center gap-5 text-sm text-white/60 md:flex">
            <Link className="hover:text-white" href="/developers">
              Docs
            </Link>
            <Link className="hover:text-white" href="/developers/dashboard">
              Dashboard
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <AuthButtons />
          </div>
        </div>
      </header>

      <div className="relative z-10">{children}</div>
    </div>
  )
}
